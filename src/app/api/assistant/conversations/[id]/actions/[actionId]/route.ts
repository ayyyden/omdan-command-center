import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

interface RouteCtx { params: Promise<{ id: string; actionId: string }> }

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const session = await requirePermission("lia:chat")
  if (session instanceof Response) return session
  const { supabase: sessionClient, userId } = session
  const { id: conversationId, actionId } = await params

  const body = await req.json().catch(() => ({}))
  const action: string = body.action ?? "" // "approve" | "reject"

  if (!["approve", "reject"].includes(action)) {
    return Response.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 })
  }

  // Verify conversation belongs to this user (session client, RLS)
  const { data: conv } = await sessionClient
    .from("assistant_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("user_id", userId)
    .single()
  if (!conv) return Response.json({ error: "Conversation not found" }, { status: 404 })

  const service = createServiceClient()
  const now = new Date().toISOString()

  // Fetch approval (service client — approvals may have service-role RLS)
  const { data: approval } = await service
    .from("assistant_approvals")
    .select("id, status, action_type, expires_at")
    .eq("id", actionId)
    .eq("conversation_id", conversationId)
    .single()

  if (!approval) return Response.json({ error: "Approval not found" }, { status: 404 })
  if (approval.status !== "pending") {
    return Response.json({ error: `Approval is already "${approval.status}"` }, { status: 400 })
  }
  if (new Date(approval.expires_at) < new Date()) {
    return Response.json({ error: "Approval has expired" }, { status: 400 })
  }

  // ── Reject ──────────────────────────────────────────────────────────────────
  if (action === "reject") {
    await service
      .from("assistant_approvals")
      .update({ status: "rejected", updated_at: now })
      .eq("id", actionId)
    return Response.json({ status: "rejected" })
  }

  // ── Approve: mark approved → call execute route ───────────────────────────
  await service
    .from("assistant_approvals")
    .update({ status: "approved", updated_at: now })
    .eq("id", actionId)

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app").replace(/\/+$/, "")

  let execResult: Record<string, unknown> = {}
  try {
    const execRes = await fetch(`${appUrl}/api/assistant/execute/${actionId}`, {
      method:  "POST",
      headers: { "x-assistant-secret": process.env.ASSISTANT_SECRET ?? "" },
    })
    execResult = await execRes.json()
    if (!execRes.ok) {
      return Response.json({ status: "failed", error: execResult.error ?? "Execution failed" }, { status: execRes.status })
    }
  } catch (err) {
    console.error("[lia/actions] execute fetch failed:", err)
    return Response.json({ status: "failed", error: "Could not reach execute endpoint" }, { status: 502 })
  }

  return Response.json({ status: "executed", result: execResult })
}
