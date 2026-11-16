import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { upsertLeadCard, todayLabel } from "@/lib/lead-card"

const SELECT_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  missed_call_count, notes, created_at, updated_at,
  attribution, utm_source, fbclid, meta_leadgen_id
`

export async function GET(_req: NextRequest) {
  const session = await requirePermission("meta_leads:view")
  if (session instanceof Response) return session
  const { supabase } = session

  // follow_up_at / list_note come with migration 067; until it's run the page
  // still loads (On Hold and Follow-up are just empty).
  const load = (fields: string) => supabase.from("meta_leads").select(fields).order("created_at", { ascending: false })
  let res = await load(`${SELECT_FIELDS}, follow_up_at, list_note`)
  if (res.error && /follow_up_at|list_note/.test(res.error.message)) res = await load(SELECT_FIELDS)
  const { data, error } = res

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const leads = (data ?? []) as unknown as Array<{ list: string; follow_up_at?: string | null }>
  const grouped = {
    call_list:          leads.filter((l) => l.list === "call_list"),
    second_call_list:   leads.filter((l) => l.list === "second_call_list"),
    schedule_call_list: leads.filter((l) => l.list === "schedule_call_list"),
    scheduled:          leads.filter((l) => l.list === "scheduled"),
    archive:            leads.filter((l) => l.list === "archive"),
    // Soonest follow-up first; no date goes last.
    follow_up:          leads.filter((l) => l.list === "follow_up")
      .sort((a, b) => (a.follow_up_at ? Date.parse(a.follow_up_at) : Infinity) - (b.follow_up_at ? Date.parse(b.follow_up_at) : Infinity)),
    on_hold:            leads.filter((l) => l.list === "on_hold"),
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

  // Lead card right away (lead-card.ts)
  const pasted = (body.raw_paste ?? "").trim()
  await upsertLeadCard(createServiceClient(), {
    name:       full_name,
    phone:      body.phone,
    email:      body.email,
    city:       body.city,
    leadSource: /facebook|instagram|meta|fb\.com/i.test(pasted) ? "facebook" : "other",
    heading:    `Added on Meta Lead Jobs — ${todayLabel()}`,
    details:    pasted ? pasted.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 40) : [],
    metaLeadId: (data as { id?: string } | null)?.id ?? null,
  }, userId).catch((e) => console.error("[meta-leads] lead card failed:", e))

  return Response.json({ lead: data }, { status: 201 })
}
