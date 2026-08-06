import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

const SELECT_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  missed_call_count, notes, created_at, updated_at
`

export async function GET(_req: NextRequest) {
  const session = await requirePermission("meta_leads:view")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data, error } = await supabase
    .from("meta_leads")
    .select(SELECT_FIELDS)
    .order("created_at", { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const leads = data ?? []
  const grouped = {
    call_list:          leads.filter((l) => l.list === "call_list"),
    second_call_list:   leads.filter((l) => l.list === "second_call_list"),
    schedule_call_list: leads.filter((l) => l.list === "schedule_call_list"),
    scheduled:          leads.filter((l) => l.list === "scheduled"),
    archive:            leads.filter((l) => l.list === "archive"),
  }

  return Response.json(grouped)
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session
  const { supabase, userId } = session

  const body = await req.json() as {
    full_name?: string
    email?: string | null
    phone?: string | null
    city?: string | null
    raw_paste?: string | null
  }

  const full_name = body.full_name?.trim()
  if (!full_name) {
    return Response.json({ error: "full_name is required" }, { status: 400 })
  }

  const { data, error } = await supabase
    .from("meta_leads")
    .insert({
      full_name,
      email:      body.email?.trim() || null,
      phone:      body.phone?.trim() || null,
      city:       body.city?.trim() || null,
      raw_paste:  body.raw_paste ?? null,
      list:       "call_list",
      created_by: userId,
    })
    .select(SELECT_FIELDS)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ lead: data }, { status: 201 })
}
