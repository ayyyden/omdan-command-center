import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createCalendarEvent } from "@/lib/google-calendar"
import { recordCallAttempt } from "@/lib/call-attempts"

interface RouteCtx { params: Promise<{ id: string }> }

const SELECT_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  missed_call_count, notes, created_at, updated_at
`

const MISSED_CALL_ARCHIVE_THRESHOLD = 10

const OUTCOMES = ["answered_scheduled", "no_answer", "callback_later"] as const
type Outcome = typeof OUTCOMES[number]

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as { outcome?: string; scheduled_at?: string }
  const { outcome, scheduled_at } = body

  if (!outcome || !OUTCOMES.includes(outcome as Outcome)) {
    return Response.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 })
  }

  // No Answer needs no calendar call — just relocate the card.
  // missed_call_count is a lifetime counter (never auto-resets): every
  // No Answer increments it, and hitting the threshold auto-archives the
  // lead instead of sending it back to Second Call List. Done as a single
  // atomic UPDATE (increment_meta_lead_missed_call, migration 061) instead
  // of a SELECT-then-UPDATE — two near-simultaneous "No Answer" presses on
  // the same lead can no longer silently lose one of the increments.
  if (outcome === "no_answer") {
    const { data, error } = await supabase
      .rpc("increment_meta_lead_missed_call", {
        p_lead_id: id,
        p_archive_threshold: MISSED_CALL_ARCHIVE_THRESHOLD,
      })
      .single()

    if (error) return Response.json({ error: error.message }, { status: 500 })
    if (!data) return Response.json({ error: "Lead not found" }, { status: 404 })

    await recordCallAttempt(supabase, id, "no_answer", "crm")
    return Response.json({ lead: data })
  }

  // Both remaining outcomes require a scheduled_at + a calendar event.
  if (!scheduled_at) {
    return Response.json({ error: "scheduled_at is required for this outcome" }, { status: 400 })
  }

  const { data: lead, error: fetchErr } = await supabase
    .from("meta_leads")
    .select("id, full_name, email, phone, city, address")
    .eq("id", id)
    .single()

  if (fetchErr || !lead) {
    return Response.json({ error: fetchErr?.message ?? "Lead not found" }, { status: 404 })
  }

  const calendarId = outcome === "answered_scheduled"
    ? process.env.META_LEADS_MAIN_CALENDAR_ID
    : process.env.META_LEADS_CALLBACK_CALENDAR_ID

  if (!calendarId) {
    return Response.json(
      { error: `Calendar is not configured (${outcome === "answered_scheduled" ? "META_LEADS_MAIN_CALENDAR_ID" : "META_LEADS_CALLBACK_CALENDAR_ID"})` },
      { status: 500 },
    )
  }

  const eventTitle = outcome === "answered_scheduled"
    ? `${lead.full_name} Lead Appointment`
    : `Call: ${lead.full_name}`

  let eventId: string
  try {
    const result = await createCalendarEvent(calendarId, lead, scheduled_at, eventTitle)
    eventId = result.eventId
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Deliberately do NOT update the DB row on calendar failure — no silent desync.
    return Response.json({ error: `Failed to create calendar event: ${msg}` }, { status: 502 })
  }

  const targetList = outcome === "answered_scheduled" ? "scheduled" : "schedule_call_list"

  const { data, error } = await supabase
    .from("meta_leads")
    .update({
      list: targetList,
      last_outcome: outcome,
      scheduled_at,
      calendar_event_id: eventId,
      calendar_id: calendarId,
    })
    .eq("id", id)
    .select(SELECT_FIELDS)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  await recordCallAttempt(supabase, id, outcome as Outcome, "crm")
  return Response.json({ lead: data })
}
