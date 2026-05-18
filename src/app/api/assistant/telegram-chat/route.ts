import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { buildCrmContext, callLiaBrain } from "@/lib/lia-brain"

// POST /api/assistant/telegram-chat
// Called by the lia-bridge for conversational AI fallback in Telegram.
// Auth: x-assistant-secret header (same secret as execute route).
// Body: { telegram_user_id: number, telegram_chat_id: number, message: string }
// Returns: { text, approval_id?, action_type?, action_summary?, action_payload? }

export async function POST(req: Request) {
  const authErr = verifyAssistantSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as {
    telegram_user_id?: number
    telegram_chat_id?: number
    message?: string
  }

  const { telegram_user_id, telegram_chat_id, message } = body
  if (!telegram_user_id || !telegram_chat_id || !message?.trim()) {
    return NextResponse.json({ error: "telegram_user_id, telegram_chat_id, message required" }, { status: 400 })
  }

  const service = createServiceClient()

  // ── Resolve owner user_id (same pattern as execute route) ──────────────────
  let ownerUserId: string | null = null

  const ownerEmail = process.env.ASSISTANT_OWNER_EMAIL
  if (ownerEmail) {
    const { data: byEmail } = await service
      .from("team_members")
      .select("user_id, role")
      .ilike("email", ownerEmail)
      .not("user_id", "is", null)
      .single()
    if (byEmail?.user_id && ["owner", "admin"].includes(byEmail.role)) {
      ownerUserId = byEmail.user_id as string
    }
  }

  if (!ownerUserId) {
    const { data: byRole } = await service
      .from("team_members")
      .select("user_id")
      .eq("role", "owner")
      .eq("status", "active")
      .not("user_id", "is", null)
      .single()
    ownerUserId = (byRole?.user_id as string) ?? null
  }

  if (!ownerUserId) {
    return NextResponse.json({ error: "Owner not found" }, { status: 500 })
  }

  // ── Find or create Telegram conversation ───────────────────────────────────
  // Keyed by title "_tg_<chatId>_<userId>" under the owner's user_id.
  const tgKey = `_tg_${telegram_chat_id}_${telegram_user_id}`
  const now   = new Date().toISOString()

  let conversationId: string

  const { data: existing } = await service
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", ownerUserId)
    .eq("title", tgKey)
    .limit(1)
    .maybeSingle()

  if (existing) {
    conversationId = existing.id
    await service.from("assistant_conversations")
      .update({ updated_at: now })
      .eq("id", conversationId)
  } else {
    const { data: newConv, error: convErr } = await service
      .from("assistant_conversations")
      .insert({ user_id: ownerUserId, title: tgKey })
      .select("id")
      .single()
    if (convErr || !newConv) {
      return NextResponse.json({ error: "Failed to create conversation" }, { status: 500 })
    }
    conversationId = newConv.id
  }

  // ── Save user message ───────────────────────────────────────────────────────
  await service.from("assistant_messages").insert({
    conversation_id: conversationId,
    role:            "user",
    content:         message.trim(),
  })

  // ── Fetch history (last 20) ────────────────────────────────────────────────
  const { data: history } = await service
    .from("assistant_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(20)

  // ── Fetch CRM context ───────────────────────────────────────────────────────
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  const [{ data: customers }, { data: jobs }, { data: appointments }] = await Promise.all([
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
    service
      .from("lead_appointments")
      .select("id, customer_id, scheduled_date, project_summary, status, source")
      .gte("scheduled_date", thirtyDaysAgo)
      .order("scheduled_date", { ascending: true })
      .limit(15),
  ])

  const today      = new Date().toISOString().split("T")[0]
  const crmContext = buildCrmContext(customers, jobs, appointments)
  const parsed     = await callLiaBrain(history ?? [], crmContext, today)

  // ── Create approval if action proposed ─────────────────────────────────────
  let approvalId: string | null = null
  if (parsed.action?.type) {
    const { data: approval } = await service
      .from("assistant_approvals")
      .insert({
        channel:          "telegram",
        action_type:      parsed.action.type,
        action_summary:   parsed.action.summary,
        proposed_payload: parsed.action.payload,
        conversation_id:  conversationId,
        expires_at:       new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single()
    approvalId = approval?.id ?? null
  }

  // ── Save assistant message ─────────────────────────────────────────────────
  await service.from("assistant_messages").insert({
    conversation_id: conversationId,
    role:            "assistant",
    content:         parsed.message,
    action_id:       approvalId,
    metadata:        parsed.action ? { action: parsed.action } : null,
  })

  return NextResponse.json({
    text:           parsed.message,
    approval_id:    approvalId    ?? undefined,
    action_type:    parsed.action?.type    ?? undefined,
    action_summary: parsed.action?.summary ?? undefined,
    action_payload: parsed.action?.payload ?? undefined,
  })
}
