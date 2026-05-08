import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

interface RouteCtx { params: Promise<{ id: string }> }

const VALID_STATUSES = [
  "new", "called_no_answer", "not_interested", "warm_lead",
  "approved", "converted", "do_not_call", "wrong_number",
  "callback_later", "no_callable_phone", "need_follow_up",
] as const

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as {
    status?: string
    notes?: string
    next_follow_up_at?: string | null
  }

  const { status, notes, next_follow_up_at } = body

  if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return Response.json({ error: `Invalid status: ${status}` }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (status)                          updates.status = status
  if (notes !== undefined)             updates.notes = notes
  if (next_follow_up_at !== undefined) updates.next_follow_up_at = next_follow_up_at

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { error } = await supabase
    .from("propstream_leads")
    .update(updates)
    .eq("id", id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
