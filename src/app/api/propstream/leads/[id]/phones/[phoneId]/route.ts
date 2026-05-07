import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

interface RouteCtx { params: Promise<{ id: string; phoneId: string }> }

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const { phoneId } = await params
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as { is_wrong_number?: boolean; is_active?: boolean }

  const updates: Record<string, unknown> = {}
  if (body.is_wrong_number !== undefined) updates.is_wrong_number = body.is_wrong_number
  if (body.is_active !== undefined)       updates.is_active = body.is_active

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { error } = await supabase
    .from("propstream_lead_phones")
    .update(updates)
    .eq("id", phoneId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
