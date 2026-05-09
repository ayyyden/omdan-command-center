import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { buildCrmContext, callLiaBrain } from "@/lib/lia-brain"

interface RouteCtx { params: Promise<{ id: string }> }

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

  // Fetch CRM context using service client
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

  const today      = new Date().toISOString().split("T")[0]
  const crmContext = buildCrmContext(customers, jobs)
  const parsed     = await callLiaBrain(history ?? [], crmContext, today)

  // Create approval record if action proposed
  let approvalId: string | null = null
  if (parsed.action?.type) {
    const { data: approval } = await service
      .from("assistant_approvals")
      .insert({
        channel:          "crm",
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

  // Save assistant message
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
  const msgCount   = history?.length ?? 0
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
