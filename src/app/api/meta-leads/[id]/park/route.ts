import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { deleteCalendarEvent } from "@/lib/google-calendar"
import { LEAD_COLUMNS, addLeadNote, ptParts, updateBookingSheet, type ScheduledLead } from "@/lib/appointments"
import { stopFollowups } from "@/lib/followups"
import { TZ } from "@/lib/retell"

interface RouteCtx { params: Promise<{ id: string }> }

const SELECT_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  missed_call_count, notes, created_at, updated_at,
  attribution, utm_source, fbclid, meta_leadgen_id, follow_up_at, list_note
`

// POST /api/meta-leads/[id]/park { list: "on_hold" | "follow_up", note?, follow_up_at? }
// Puts a lead on the quiet lists. NOTHING is sent to the customer, now or later:
//   - a booked estimate is taken off the Google Calendar (otherwise the calendar
//     sync would put it straight back on Scheduled and the 24-hour reminder text
//     would go out), its booking-sheet row is cancelled and its confirmation
//     tracking is closed
//   - a "call back later" reminder event is removed too
//   - automatic follow-up texts to this number are stopped
// Back to work: "Restore to Call List" or log an outcome (e.g. schedule them).
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => ({})) as { list?: string; note?: string | null; follow_up_at?: string | null }
  const list = body.list === "on_hold" || body.list === "follow_up" ? body.list : null
  if (!list) return Response.json({ error: "list must be on_hold or follow_up" }, { status: 400 })
  const followUpAt = list === "follow_up" && body.follow_up_at ? new Date(body.follow_up_at) : null
  if (followUpAt && Number.isNaN(followUpAt.getTime())) return Response.json({ error: "Invalid follow-up date" }, { status: 400 })
  const note = (body.note ?? "").trim().slice(0, 500) || null

  const service = createServiceClient()
  // Before touching the calendar: the lists need migration 067.
  const probe = await service.from("meta_leads").select("follow_up_at, list_note").limit(1)
  if (probe.error) return Response.json({ error: "Run migration 067 in Supabase first (On Hold / Follow-up lists)." }, { status: 500 })

  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle()
  const lead = data as ScheduledLead | null
  if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 })

  // Its calendar event (a booked estimate, or a call-back reminder) comes off first:
  // if that fails, nothing changes, so the lead can't end up half-moved.
  const hadAppointment = lead.list === "scheduled" && !!lead.scheduled_at && new Date(lead.scheduled_at) > new Date()
  if (lead.calendar_event_id) {
    const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
    if (calendarId) {
      try { await deleteCalendarEvent(calendarId, lead.calendar_event_id) }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return Response.json({ error: `Couldn't remove it from the Google Calendar: ${msg}` }, { status: 502 })
      }
    }
    // Booked in the CRM: its appointment record is cancelled too.
    await service.from("lead_appointments").update({ status: "cancelled", calendar_event_id: null, calendar_id: null })
      .eq("calendar_event_id", lead.calendar_event_id)
  }
  if (hadAppointment) {
    if (lead.phone) {
      const old = ptParts(lead.scheduled_at!)
      await updateBookingSheet({ phone: lead.phone, date: old.date, time: old.time, cancel: true })
    }
    await service.from("appointment_confirmations").update({ status: "cancelled", notes: `Lead moved to ${list === "on_hold" ? "On Hold" : "Follow-up"}` })
      .eq("meta_lead_id", lead.id).eq("status", "pending")
  }
  if (lead.phone) await stopFollowups(service, lead.phone, "stopped")

  const label = list === "on_hold" ? "On Hold" : "Follow-up"
  const when = followUpAt ? ` (follow up ${followUpAt.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })})` : ""
  await addLeadNote(service, lead, `Moved to ${label}${when}${hadAppointment ? ", estimate taken off the calendar" : ""}${note ? `: ${note}` : ""}`)

  const { data: updated, error } = await service.from("meta_leads").update({
    list,
    last_outcome:      list,
    list_note:         note,
    follow_up_at:      followUpAt?.toISOString() ?? null,
    scheduled_at:      null,
    calendar_event_id: null,
    calendar_id:       null,
  }).eq("id", id).select(SELECT_FIELDS).single()

  if (error) {
    const missing = /list_check|follow_up_at|list_note/.test(error.message)
    return Response.json({ error: missing ? "Run migration 067 in Supabase first (On Hold / Follow-up lists)." : error.message }, { status: 500 })
  }
  return Response.json({ lead: updated })
}
