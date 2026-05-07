import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function GET(req: NextRequest) {
  const session = await requirePermission("propstream:view")
  if (session instanceof Response) return session
  const { supabase } = session

  const { searchParams } = new URL(req.url)
  const list_id   = searchParams.get("list_id")
  const status    = searchParams.get("status")
  const search    = searchParams.get("search")?.trim()
  const has_phone = searchParams.get("has_phone")
  const page      = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10))
  const limit     = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)))
  const from      = (page - 1) * limit
  const to        = from + limit - 1

  let query = supabase
    .from("propstream_leads")
    .select(
      `id, list_id, owner_name, owner2_name, property_address, property_city,
       property_state, property_zip, status, next_follow_up_at, last_called_at,
       last_contacted_phone, notes, estimated_value, estimated_equity, emails,
       created_at, updated_at,
       propstream_lead_phones(id, phone, phone_type, is_active, is_wrong_number, position)`,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(from, to)

  if (list_id)  query = query.eq("list_id", list_id)
  if (status)   query = query.eq("status", status)
  if (search)   query = query.ilike("owner_name", `%${search}%`)
  if (has_phone === "true")  query = query.neq("status", "no_callable_phone")
  if (has_phone === "false") query = query.eq("status", "no_callable_phone")

  const { data, error, count } = await query

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ leads: data ?? [], total: count ?? 0, page, limit })
}
