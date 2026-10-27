// The Google Calendar decides who Sofia calls to confirm. The confirm cron
// reads the main calendar and turns each upcoming appointment into the meta
// lead record the rest of the confirmation flow works with (texts, YES / 2
// replies, reschedule, cancel):
//   event linked to a meta lead     -> that lead; the event's time wins if it was moved
//   event added another way         -> linked to the meta lead with the same phone,
//                                      or a new one created on the "scheduled" list
//   job events, all-day events and events without a phone number are skipped.
// A meta lead on the "scheduled" list that isn't on the calendar gets no call.

import type { SupabaseClient } from "@supabase/supabase-js"
import { listUpcomingEvents, type CalendarEventSummary } from "@/lib/google-calendar"
import { parseAppointment } from "@/lib/lead-from-appointment"
import { toE164 } from "@/lib/quo-client"
import { phoneDigits } from "@/lib/retell"
import { LEAD_COLUMNS, type ScheduledLead } from "@/lib/appointments"

export interface CalendarAppointment {
  lead:              ScheduledLead
  /** When the appointment was put on the calendar (for "they just booked"). */
  bookedAt:          string
  /** Marked confirmed on the calendar (Calendar page button / green event). */
  calendarConfirmed: boolean
}

export interface SkippedEvent { title: string; start: string | null; reason: string }

type Contact = { name: string | null; phone: string | null; address: string | null }

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export async function calendarAppointments(
  service: SupabaseClient,
  hoursAhead: number,
  { dry = false }: { dry?: boolean } = {},
): Promise<{ appointments: CalendarAppointment[]; skipped: SkippedEvent[] }> {
  const calendarId = process.env.META_LEADS_MAIN_CALENDAR_ID
  if (!calendarId) throw new Error("Calendar not configured (META_LEADS_MAIN_CALENDAR_ID)")

  const events = await listUpcomingEvents(calendarId, { daysAhead: hoursAhead / 24, maxResults: 250 })
  const ids = events.map((e) => e.id).filter(Boolean)
  const skipped: SkippedEvent[] = []
  if (!ids.length) return { appointments: [], skipped }

  const [jobs, appts, metas] = await Promise.all([
    service.from("jobs").select("calendar_event_id").in("calendar_event_id", ids),
    service.from("lead_appointments").select("calendar_event_id, customer:customers(name, phone, address)").in("calendar_event_id", ids),
    service.from("meta_leads").select(LEAD_COLUMNS).in("calendar_event_id", ids),
  ])
  const jobEvents = new Set((jobs.data ?? []).map((j) => j.calendar_event_id))
  const partnerContacts = new Map<string, Contact>()
  for (const row of appts.data ?? []) {
    const c = one(row.customer as Contact | Contact[] | null)
    if (row.calendar_event_id && c) partnerContacts.set(row.calendar_event_id, c)
  }
  const linked = new Map<string, ScheduledLead>()
  for (const lead of (metas.data ?? []) as ScheduledLead[]) {
    if (lead.calendar_event_id) linked.set(lead.calendar_event_id, lead)
  }

  const appointments: CalendarAppointment[] = []
  for (const ev of events) {
    const skip = (reason: string) => skipped.push({ title: ev.title, start: ev.start, reason })
    if (!ev.start || !ev.start.includes("T")) { skip("all-day event"); continue }
    if (jobEvents.has(ev.id)) { skip("job, not an estimate"); continue }

    const startIso = new Date(ev.start).toISOString()
    let lead: ScheduledLead | null = linked.get(ev.id) ?? null
    if (!lead) lead = await linkEventToLead(service, calendarId, ev, startIso, partnerContacts.get(ev.id) ?? null, ids, dry)
    if (!lead) { skip("no phone number on the event"); continue }

    // The calendar is the schedule: an event moved there moves the appointment.
    if (lead.list !== "scheduled" || !lead.scheduled_at || new Date(lead.scheduled_at).getTime() !== new Date(startIso).getTime()) {
      if (!dry) await service.from("meta_leads").update({ list: "scheduled", scheduled_at: startIso }).eq("id", lead.id)
      lead = { ...lead, list: "scheduled", scheduled_at: startIso }
    }
    appointments.push({ lead, bookedAt: ev.created ?? lead.created_at, calendarConfirmed: ev.confirmed })
  }
  return { appointments, skipped }
}

/** An event that isn't linked to a meta lead yet: link it to the lead with the
 *  same phone (when that lead isn't already tied to another upcoming event), or
 *  create one. Returns null when the event has no phone number to call.
 *  dry: writes nothing (a new lead comes back with id "(new)"). */
async function linkEventToLead(
  service: SupabaseClient,
  calendarId: string,
  ev: CalendarEventSummary,
  startIso: string,
  partner: Contact | null,
  upcomingEventIds: string[],
  dry: boolean,
): Promise<ScheduledLead | null> {
  const parsed = parseAppointment(ev)
  const phone = toE164(partner?.phone || parsed.phone || "")
  if (!phone) return null
  const digits = phoneDigits(phone)

  const { data: samePhone } = await service.from("meta_leads").select(LEAD_COLUMNS)
    .ilike("phone", `%${digits.slice(-4)}%`).order("created_at", { ascending: false })
  const existing = ((samePhone ?? []) as ScheduledLead[]).find((l) =>
    phoneDigits(l.phone) === digits && (!l.calendar_event_id || !upcomingEventIds.includes(l.calendar_event_id)))
  const link = { calendar_event_id: ev.id, calendar_id: calendarId, list: "scheduled", scheduled_at: startIso }
  if (existing) {
    if (!dry) await service.from("meta_leads").update(link).eq("id", existing.id)
    return { ...existing, ...link }
  }

  const name = partner?.name || parsed.name || "Customer"
  if (dry) {
    return { id: "(new)", full_name: name, phone, address: partner?.address || parsed.address, city: null, notes: ev.description,
      created_at: ev.created ?? new Date().toISOString(), ...link }
  }

  const description = (ev.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").trim()
  const { data, error } = await service.from("meta_leads").insert({
    ...link,
    full_name:    name,
    phone,
    email:        parsed.email,
    address:      partner?.address || parsed.address,
    raw_paste:    `Calendar event ${ev.id}`,
    last_outcome: "answered_scheduled",
    notes:        [`Source: Google Calendar ("${ev.title.trim()}")`, description].filter(Boolean).join("\n"),
    // Booked when it went on the calendar, not when the cron first saw it.
    ...(ev.created ? { created_at: ev.created } : {}),
  }).select(LEAD_COLUMNS).single()
  if (error) {
    console.error("[calendar-appointments] lead insert failed:", error.message)
    return null
  }
  return data as ScheduledLead
}
