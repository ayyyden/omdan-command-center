// On Hold / Follow-up: a customer who isn't ready (wants to reschedule but
// doesn't know when, wants to think about it, or stopped answering). Moving
// them there frees their spot everywhere, and NOTHING is sent to them:
//   - the appointment comes off the Google Calendar (that's what the website,
//     the CRM's Add lead form and Sofia check for open times, so the spot opens
//     right away; it also stops the calendar sync from re-booking them and the
//     24-hour reminder text from going out)
//   - its row in the booking backend's Leads sheet is cancelled
//   - a CRM-booked appointment record is cancelled; confirmation tracking closed
//   - a "call back later" reminder event is removed too
//   - automatic follow-up texts to this number are stopped
// They wait on the Leads page (Meta Lead Jobs → Follow-up / On Hold) until
// someone books them again or moves them back to the Call List.

import type { SupabaseClient } from "@supabase/supabase-js"
import { deleteCalendarEvent } from "@/lib/google-calendar"
import { LEAD_COLUMNS, addLeadNote, ptParts, updateBookingSheet, type ScheduledLead } from "@/lib/appointments"
import { stopFollowups } from "@/lib/followups"
import { TZ } from "@/lib/retell"

export type ParkList = "on_hold" | "follow_up"

export const PARKED_LEAD_FIELDS = `
  id, full_name, email, phone, city, address, raw_paste,
  list, last_outcome, scheduled_at, calendar_event_id, calendar_id,
  missed_call_count, notes, created_at, updated_at,
  attribution, utm_source, fbclid, meta_leadgen_id, follow_up_at, list_note
`

const NEEDS_MIGRATION = "Run migration 067 in Supabase first (On Hold / Follow-up lists)."

export async function parkLead(
  service: SupabaseClient,
  leadId: string,
  list: ParkList,
  opts: { note?: string | null; followUpAt?: Date | null },
): Promise<{ ok: true; lead: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  // Before touching the calendar: the lists need migration 067.
  const probe = await service.from("meta_leads").select("follow_up_at, list_note").limit(1)
  if (probe.error) return { ok: false, error: NEEDS_MIGRATION, status: 500 }

  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", leadId).maybeSingle()
  const lead = data as ScheduledLead | null
  if (!lead) return { ok: false, error: "Lead not found", status: 404 }
  const note = (opts.note ?? "").trim().slice(0, 500) || null
  const followUpAt = list === "follow_up" ? opts.followUpAt ?? null : null

  // The calendar event comes off first: if that fails nothing changes, so the
  // customer can't end up half-moved (on the list but still booked).
  const hadAppointment = lead.list === "scheduled" && !!lead.scheduled_at
  if (lead.calendar_event_id) {
    const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
    if (calendarId) {
      try { await deleteCalendarEvent(calendarId, lead.calendar_event_id) }
      catch (err) {
        return { ok: false, error: `Couldn't remove it from the Google Calendar: ${err instanceof Error ? err.message : String(err)}`, status: 502 }
      }
    }
    await service.from("lead_appointments").update({ status: "cancelled", calendar_event_id: null, calendar_id: null })
      .eq("calendar_event_id", lead.calendar_event_id)
  }
  let sheet = ""
  if (hadAppointment) {
    if (lead.phone) {
      const old = ptParts(lead.scheduled_at!)
      const r = await updateBookingSheet({ phone: lead.phone, date: old.date, time: old.time, cancel: true })
      sheet = r.found ? ", booking sheet row cancelled" : ""
    }
    await service.from("appointment_confirmations")
      .update({ status: "cancelled", notes: `Moved to ${list === "on_hold" ? "On Hold" : "Follow-up"}` })
      .eq("meta_lead_id", lead.id).in("status", ["pending", "confirmed"]).gte("scheduled_at", new Date().toISOString())
  }
  if (lead.phone) await stopFollowups(service, lead.phone, "stopped")

  const label = list === "on_hold" ? "On Hold" : "Follow-up"
  const was = hadAppointment ? `, ${ptParts(lead.scheduled_at!).date} ${ptParts(lead.scheduled_at!).time} appointment taken off the calendar${sheet}` : ""
  const when = followUpAt ? ` (follow up ${followUpAt.toLocaleDateString("en-US", { timeZone: TZ, month: "short", day: "numeric" })})` : ""
  await addLeadNote(service, lead, `Moved to ${label}${when}${was}${note ? `: ${note}` : ""}`)

  const { data: updated, error } = await service.from("meta_leads").update({
    list,
    last_outcome:      list,
    list_note:         note,
    follow_up_at:      followUpAt?.toISOString() ?? null,
    scheduled_at:      null,
    calendar_event_id: null,
    calendar_id:       null,
  }).eq("id", leadId).select(PARKED_LEAD_FIELDS).single()
  if (error) return { ok: false, error: /list_check|follow_up_at|list_note/.test(error.message) ? NEEDS_MIGRATION : error.message, status: 500 }
  return { ok: true, lead: updated as Record<string, unknown> }
}
