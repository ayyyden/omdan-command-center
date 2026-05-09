import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: RouteCtx) {
  const session = await requirePermission("lia:chat")
  if (session instanceof Response) return session
  const { supabase: sessionClient, userId } = session
  const { id: conversationId } = await params

  // Verify ownership via session client (respects RLS)
  const { data: conv } = await sessionClient
    .from("assistant_conversations")
    .select("id, title, created_at, updated_at")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single()

  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 })

  // Fetch messages via session client (RLS scoped to conversation owner)
  const { data: messages, error: msgsErr } = await sessionClient
    .from("assistant_messages")
    .select("id, role, content, action_id, metadata, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })

  if (msgsErr) return Response.json({ error: msgsErr.message }, { status: 500 })

  // Fetch approval statuses for any action_ids (service client bypasses RLS)
  const actionIds = (messages ?? []).map((m) => m.action_id).filter(Boolean) as string[]
  let approvalMap: Record<string, { status: string; result: unknown }> = {}

  if (actionIds.length) {
    const service = createServiceClient()
    const { data: approvals } = await service
      .from("assistant_approvals")
      .select("id, status, result")
      .in("id", actionIds)
    for (const a of approvals ?? []) {
      approvalMap[a.id] = { status: a.status, result: a.result }
    }
  }

  const enriched = (messages ?? []).map((m) => ({
    ...m,
    approval: m.action_id ? (approvalMap[m.action_id] ?? null) : null,
  }))

  return Response.json({ conversation: conv, messages: enriched })
}
