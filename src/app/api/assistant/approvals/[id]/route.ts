import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

interface RouteCtx { params: Promise<{ id: string }> }

const VALID_STATUSES = ["approved", "rejected", "edited", "executed", "failed"] as const
type TransitionStatus = typeof VALID_STATUSES[number]

// PATCH /api/assistant/approvals/[id] — update approval status
export async function PATCH(req: Request, { params }: RouteCtx) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const { id } = await params
  const body = await req.json() as {
    status: TransitionStatus
    result?: unknown
    error?: string
    proposed_payload?: unknown
  }

  if (!VALID_STATUSES.includes(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
      { status: 400 }
    )
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = { status: body.status, updated_at: now }

  if (body.status === "approved")  update.approved_at  = now
  if (body.status === "rejected")  update.rejected_at  = now
  if (body.status === "executed")  update.executed_at  = now
  if (body.result   !== undefined) update.result        = body.result
  if (body.error    !== undefined) update.error         = body.error
  if (body.proposed_payload !== undefined) update.proposed_payload = body.proposed_payload

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("assistant_approvals")
    .update(update)
    .eq("id", id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ approval: data })
}
