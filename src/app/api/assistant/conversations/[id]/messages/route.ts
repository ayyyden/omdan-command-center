import { NextRequest } from "next/server"
import Anthropic from "@anthropic-ai/sdk"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

interface RouteCtx { params: Promise<{ id: string }> }

interface ActionDraft {
  type: string
  summary: string
  payload: Record<string, unknown>
  risk_level: "low" | "medium" | "high"
}

interface ClaudeResponse {
  message: string
  action?: ActionDraft
}

// ─── CRM context builder ──────────────────────────────────────────────────────

function buildCrmContext(
  customers: Array<{ id: string; name: string; phone: string | null; email: string | null; status: string | null }> | null,
  jobs: Array<{ id: string; title: string; status: string; scheduled_date: string | null; customer_id: string }> | null,
): string {
  const lines: string[] = []

  if (customers?.length) {
    lines.push("RECENT CUSTOMERS:")
    for (const c of customers) {
      const jobList = (jobs ?? [])
        .filter((j) => j.customer_id === c.id)
        .map((j) => j.title)
        .join(", ")
      lines.push(
        `  id=${c.id} | name="${c.name}" | phone=${c.phone ?? "none"} | email=${c.email ?? "none"} | status=${c.status ?? "?"} | jobs=[${jobList || "none"}]`,
      )
    }
  } else {
    lines.push("RECENT CUSTOMERS: (none yet)")
  }

  if (jobs?.length) {
    lines.push("")
    lines.push("ACTIVE JOBS:")
    const custMap = Object.fromEntries((customers ?? []).map((c) => [c.id, c.name]))
    for (const j of jobs) {
      lines.push(
        `  id=${j.id} | title="${j.title}" | customer="${custMap[j.customer_id] ?? "?"}" | customer_id=${j.customer_id} | status=${j.status} | scheduled=${j.scheduled_date ?? "none"}`,
      )
    }
  } else {
    lines.push("")
    lines.push("ACTIVE JOBS: (none yet)")
  }

  return lines.join("\n")
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(crmContext: string, today: string): string {
  return `You are Lia, the AI CRM assistant for Omdan Development — a residential construction and landscaping company.
You help the owner manage customers, jobs, invoices, estimates, and scheduling.

TODAY: ${today}

APPROVAL-FIRST RULE: You NEVER execute anything directly. When you want to perform an action,
you propose an action card that the user must approve before anything happens.

RESPONSE FORMAT: Always respond with valid JSON only — no markdown, no code fences.
{
  "message": "Your conversational reply",
  "action": {        // optional — only include when proposing an action
    "type": "...",
    "summary": "One-line description of what will happen",
    "payload": { ... },
    "risk_level": "low" | "medium" | "high"
  }
}

AVAILABLE ACTION TYPES AND THEIR PAYLOADS:

create_invoice — Creates a DRAFT invoice (not emailed). risk: low
  payload: { customer_id, customer_name, job_id, job_title, amount, type ("deposit"|"progress"|"final"|"other"), notes, due_date (YYYY-MM-DD|null), payment_methods (["zelle","cash","check"]) }

create_send_invoice — Creates an invoice AND emails it to the customer. risk: medium
  payload: { customer_id, customer_name, customer_email, job_id, job_title, amount, type, notes, due_date, payment_methods }

create_estimate — Creates a DRAFT estimate for an existing customer. risk: low
  payload: { customer_id, customer_name, customer_email, services, total, payment_steps ([{name,amount}]|null) }

schedule_job — Updates a job's scheduled date/time. risk: low
  payload: { job_id, job_title, new_scheduled_date (YYYY-MM-DD), new_scheduled_time ("HH:MM"|null) }

update_note — Replaces the internal notes on a customer or job. risk: low
  payload: { entity_type ("customer"|"job"), entity_id, entity_name, notes }

RULES:
- Always use UUIDs from the CRM CONTEXT section — NEVER invent IDs.
- For create_invoice / create_send_invoice, job_id is REQUIRED. If you see no jobs for this customer, ask.
- Be concise — 1 to 3 sentences in your message field.
- If required info is missing, ask exactly one follow-up question (no action block needed).
- Do not invent brands, measurements, warranties, or anything the user did not specify.

CRM CONTEXT:
${crmContext}`
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const session = await requirePermission("lia:chat")
  if (session instanceof Response) return session
  const { supabase: sessionClient, userId } = session
  const { id: conversationId } = await params

  // Verify conversation belongs to this user
  const { data: conv } = await sessionClient
    .from("assistant_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single()
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const userMessage: string = (body.message ?? "").trim()
  if (!userMessage) return Response.json({ error: "message is required" }, { status: 400 })

  // Save user message
  await sessionClient
    .from("assistant_messages")
    .insert({ conversation_id: conversationId, role: "user", content: userMessage })

  // Fetch conversation history (last 20 messages for context)
  const { data: history } = await sessionClient
    .from("assistant_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20)

  // Fetch CRM context using service client (owner's data scope)
  const service = createServiceClient()
  const [{ data: customers }, { data: jobs }] = await Promise.all([
    service
      .from("customers")
      .select("id, name, phone, email, status")
      .order("created_at", { ascending: false })
      .limit(15),
    service
      .from("jobs")
      .select("id, title, status, scheduled_date, customer_id")
      .not("status", "eq", "archived")
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  const today = new Date().toISOString().split("T")[0]
  const crmContext = buildCrmContext(customers, jobs)
  const systemPrompt = buildSystemPrompt(crmContext, today)

  // Build message array for Claude (role alternation enforced)
  const claudeMessages: Array<{ role: "user" | "assistant"; content: string }> = []
  for (const m of history ?? []) {
    if (m.role === "user" || m.role === "assistant") {
      claudeMessages.push({ role: m.role, content: m.content })
    }
  }

  // Call Claude
  let parsed: ClaudeResponse = { message: "I encountered an error. Please try again." }

  if (!process.env.ANTHROPIC_API_KEY) {
    parsed = { message: "Lia is not configured yet — ANTHROPIC_API_KEY is missing." }
  } else {
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      const result = await anthropic.messages.create({
        model:      "claude-haiku-4-5-20251001",
        max_tokens: 1000,
        system:     systemPrompt,
        messages:   claudeMessages,
      })
      const rawText = result.content[0]?.type === "text" ? result.content[0].text.trim() : ""
      const jsonMatch = rawText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]) as ClaudeResponse
      } else {
        parsed = { message: rawText || "Sorry, I didn't understand that." }
      }
    } catch (err) {
      console.error("[lia/messages] Claude error:", err)
      parsed = { message: "I hit an error talking to Claude. Please try again." }
    }
  }

  // Create approval record if action proposed
  let approvalId: string | null = null
  if (parsed.action?.type) {
    const { data: approval } = await service
      .from("assistant_approvals")
      .insert({
        channel:         "crm",
        action_type:     parsed.action.type,
        action_summary:  parsed.action.summary,
        proposed_payload: parsed.action.payload,
        conversation_id: conversationId,
        expires_at:      new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single()
    approvalId = approval?.id ?? null
  }

  // Save assistant message (session client — RLS via conversation ownership)
  const { data: assistantMsg } = await sessionClient
    .from("assistant_messages")
    .insert({
      conversation_id: conversationId,
      role:            "assistant",
      content:         parsed.message,
      action_id:       approvalId,
      metadata:        parsed.action ? { action: parsed.action } : null,
    })
    .select("id, created_at")
    .single()

  // Update conversation updated_at (and title on first exchange)
  const msgCount = history?.length ?? 0
  const convUpdate: Record<string, string> = { updated_at: new Date().toISOString() }
  if (msgCount <= 2) convUpdate.title = userMessage.slice(0, 60)
  await sessionClient
    .from("assistant_conversations")
    .update(convUpdate)
    .eq("id", conversationId)

  return Response.json({
    id:         assistantMsg?.id ?? null,
    role:       "assistant",
    content:    parsed.message,
    action_id:  approvalId,
    action:     parsed.action ?? null,
    created_at: assistantMsg?.created_at ?? new Date().toISOString(),
  })
}
