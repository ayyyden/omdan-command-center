import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

interface RouteCtx { params: Promise<{ id: string }> }

const SELECT_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  notes, created_at, updated_at
`

export async function PATCH(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as {
    full_name?: string
    email?: string | null
    phone?: string | null
    city?: string | null
    address?: string | null
    notes?: string | null
  }

  const updates: Record<string, unknown> = {}
  if (body.full_name !== undefined) {
    const trimmed = body.full_name.trim()
    if (!trimmed) return Response.json({ error: "full_name cannot be empty" }, { status: 400 })
    updates.full_name = trimmed
  }
  if (body.email   !== undefined) updates.email   = body.email?.trim() || null
  if (body.phone   !== undefined) updates.phone   = body.phone?.trim() || null
  if (body.city    !== undefined) updates.city    = body.city?.trim() || null
  if (body.address !== undefined) updates.address = body.address?.trim() || null
  if (body.notes   !== undefined) updates.notes   = body.notes?.trim() || null

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "Nothing to update" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("meta_leads")
    .update(updates)
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ lead: data })
}

export async function DELETE(_req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session
  const { supabase } = session

  const { error } = await supabase.from("meta_leads").delete().eq("id", id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
