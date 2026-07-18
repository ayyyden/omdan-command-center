import { NextResponse } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

const VALID_CATEGORIES = new Set([
  "labor","materials","subcontractors","permits","dump_fees","travel",
  "equipment","gas","vehicle","tools","office_rent","software",
  "insurance","marketing","meals","misc",
  "utilities","office_supplies","advertising","professional_services",
])

const client = new Anthropic()

const SYSTEM_PROMPT = `You are an expense tracking assistant. You will receive a screenshot of bank or credit card transactions.

Extract ALL transactions visible in the image and return them as JSON.

Determine the business expense category for each transaction from this list ONLY:
labor, materials, subcontractors, permits, dump_fees, travel, equipment, gas, vehicle,
tools, office_rent, software, insurance, marketing, meals, misc, utilities,
office_supplies, advertising, professional_services

Category rules:
- Home Depot, Lowe's, lumber yards → materials
- Gas stations, fuel (Shell, BP, Chevron, Exxon) → gas
- Restaurants, fast food, food delivery (McDonald's, DoorDash, Uber Eats) → meals
- Google Ads, Meta/Facebook, advertising platforms → advertising
- Insurance companies, State Farm, Allstate → insurance
- Amazon (non-tools), Staples, office supply stores → office_supplies
- Electric, water, internet, phone bills (AT&T, Verizon, ConEd) → utilities
- Software subscriptions (QuickBooks, Adobe, Slack, Microsoft) → software
- Auto parts, car repairs, vehicle registration → vehicle
- Uber, Lyft, flights, tolls, parking → travel
- Tools, hardware stores for tools → tools
- Rent, office space → office_rent
- Consulting, legal, accounting fees → professional_services
- Anything else → misc

Return ONLY a JSON object with this exact shape — no markdown, no explanation:
{"transactions":[{"date":"YYYY-MM-DD","description":"vendor name","amount":12.34,"card_last4":"1234","category":"category_name","notes":null}]}

If card last 4 digits are not visible set card_last4 to null.
If date is not readable use today's date.
Amount must be a positive number (no currency symbols).`

export async function POST(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const body = await req.json() as {
    image_base64:     string
    media_type:       string
    telegram_user_id: number
    telegram_chat_id: number
    caption?:         string
  }

  const { image_base64, media_type, telegram_user_id, caption } = body

  if (!image_base64 || !media_type) {
    return NextResponse.json({ error: "image_base64 and media_type are required" }, { status: 400 })
  }

  const response = await client.messages.create({
    model:      "claude-opus-4-8",
    max_tokens: 4096,
    thinking:   { type: "adaptive" },
    system:     SYSTEM_PROMPT,
    messages: [{
      role:    "user",
      content: [
        {
          type:   "image",
          source: {
            type:       "base64",
            media_type: media_type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data:       image_base64,
          },
        },
        {
          type: "text",
          text: caption
            ? `Parse all transactions from this statement screenshot. Additional context: ${caption}`
            : "Parse all transactions from this statement screenshot.",
        },
      ],
    }],
  })

  const textBlock = response.content.find((b) => b.type === "text")
  if (!textBlock || textBlock.type !== "text") {
    return NextResponse.json({ error: "Claude returned no text content" }, { status: 500 })
  }

  type RawTransaction = {
    date:        string
    description: string
    amount:      number
    card_last4:  string | null
    category:    string
    notes:       string | null
  }

  let transactions: RawTransaction[]
  try {
    let raw = textBlock.text.trim()
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) raw = fenceMatch[1].trim()
    if (!raw.startsWith("{") && !raw.startsWith("[")) {
      const jsonStart = raw.search(/[{[]/)
      if (jsonStart !== -1) raw = raw.slice(jsonStart)
    }
    const parsed = JSON.parse(raw) as { transactions?: RawTransaction[] } | RawTransaction[]
    transactions = (Array.isArray(parsed) ? parsed : (parsed as { transactions?: RawTransaction[] }).transactions) ?? []
    if (!Array.isArray(transactions)) throw new Error("not an array")
  } catch {
    return NextResponse.json(
      { error: "Failed to parse Claude response", raw: textBlock.text.slice(0, 500) },
      { status: 500 },
    )
  }

  // Sanitize categories
  transactions = transactions.map((t) => ({
    ...t,
    amount:   Number(t.amount),
    category: VALID_CATEGORIES.has(t.category) ? t.category : "misc",
  }))

  const total = transactions.reduce((sum, t) => sum + t.amount, 0)

  const previewLines = [
    `📸 Found ${transactions.length} transaction${transactions.length !== 1 ? "s" : ""} — total $${total.toFixed(2)}`,
    ...transactions.slice(0, 6).map(
      (t) => `  • ${t.date} · ${t.description} · $${t.amount.toFixed(2)} (${t.category})`
    ),
    transactions.length > 6 ? `  …and ${transactions.length - 6} more` : "",
  ].filter(Boolean).join("\n")

  const supabase = createServiceClient()
  const { data: approval, error: approvalErr } = await supabase
    .from("assistant_approvals")
    .insert({
      channel:               "telegram",
      action_type:           "save_expenses_batch",
      action_summary:        `Save ${transactions.length} expense${transactions.length !== 1 ? "s" : ""} — total $${total.toFixed(2)}`,
      proposed_payload:      { expenses: transactions },
      requested_by_external: String(telegram_user_id),
      expires_at:            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single()

  if (approvalErr || !approval) {
    return NextResponse.json(
      { error: `Failed to create approval: ${approvalErr?.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({
    approval_id: approval.id,
    preview:     previewLines,
    count:       transactions.length,
    total,
  })
}
