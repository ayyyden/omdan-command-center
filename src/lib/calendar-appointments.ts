// The Google Calendar decides who Sofia calls to confirm. The confirm cron
// reads the main calendar and turns each upcoming appointment into the meta
// lead record the rest of the confirmation flow works with (texts, YES / 2
// replies, reschedule, cancel):
//   event linked to a meta lead     -> that lead; the event's time wins if it was moved
//   event added another way         -> linked to the meta lead with the same phone,
//                                      or a new one created on the "scheduled" list
//   job events, all-day events and events without a phone number are skipped.
// The event is the source of truth: its name, phone, address, company and
// language are copied onto the lead every run. A lead whose event was deleted
// is unlinked, and Sofia (calls, caller lookup, text replies) only counts
// appointments linked to the calendar.

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
  if (!dry) await unlinkDeletedEvents(service, ids, hoursAhead)
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

    // The calendar is the schedule: its time and details win.
    const changes = changesFromEvent(lead, ev, startIso, partnerContacts.get(ev.id) ?? null)
    if (Object.keys(changes).length) {
      if (!dry) await service.from("meta_leads").update(changes).eq("id", lead.id)
      lead = { ...lead, ...changes }
    }
    appointments.push({ lead, bookedAt: ev.created ?? lead.created_at, calendarConfirmed: ev.confirmed })
  }
  return { appointments, skipped }
}

/** Which company the event says it's with: a "Company:" line, else the
 *  website's own wording ("Omdan estimate: …", "Omdan Development: …"). */
function companyFromEvent(ev: CalendarEventSummary): string | null {
  const text = `${ev.title}\n${ev.description ?? ""}`.replace(/<[^>]+>/g, "\n")
  const line = text.match(/^\s*Company\s*[:\-]\s*(.+?)\s*$/im)?.[1]
  if (line) return /omdan/i.test(line) ? "Omdan Development" : /desert\s*green/i.test(line) ? "Desert Green Builders" : null
  if (/Omdan (estimate|Development)\b/i.test(text)) return "Omdan Development"
  if (/Desert Green Builders/i.test(text)) return "Desert Green Builders"
  return null
}

function nameLine(ev: CalendarEventSummary): string | null {
  const text = (ev.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  return text.match(/^\s*(?:Name|Customer)\s*[:\-]\s*(.+?)\s*$/im)?.[1] ?? null
}

/** Name for a new lead: a "Name:" line, else the title without its "…:" prefix. */
function nameForNewLead(ev: CalendarEventSummary, parsed: ReturnType<typeof parseAppointment>): string | null {
  return nameLine(ev) || parsed.name?.replace(/^.*?:\s*/, "").trim() || null
}

/** What on the lead differs from its calendar event (time, name, phone, address,
 *  company, Spanish), as a meta_leads update. Empty when they already match. */
function changesFromEvent(lead: ScheduledLead, ev: CalendarEventSummary, startIso: string, partner: Contact | null): Partial<ScheduledLead> {
  const parsed = parseAppointment(ev)
  const changes: Partial<ScheduledLead> = {}
  if (lead.list !== "scheduled") changes.list = "scheduled"
  if (!lead.scheduled_at || new Date(lead.scheduled_at).getTime() !== new Date(startIso).getTime()) changes.scheduled_at = startIso
  // Titles carry prefixes ("Omdan estimate: …", "Home launch Lead …"), so an existing
  // lead only takes the name from an explicit "Name:" line or a partner customer.
  const name = partner?.name || nameLine(ev)
  if (name && name !== lead.full_name) changes.full_name = name
  const phone = toE164(partner?.phone || parsed.phone || "")
  if (phone && phoneDigits(phone) !== phoneDigits(lead.phone)) changes.phone = phone
  const address = partner?.address || parsed.address
  if (address && address !== lead.address) changes.address = address

  let notes = lead.notes ?? ""
  const company = companyFromEvent(ev)
  const current = [...notes.matchAll(/^Company:\s*(.+)$/gim)].pop()?.[1]?.trim()
  if (company && company !== current) {
    notes = current ? notes.replace(/^Company:.*$/gim, `Company: ${company}`) : [notes, `Company: ${company}`].filter(Boolean).join("\n")
  }
  if (/Language:\s*Spanish/i.test(ev.description ?? "") && !/Language:\s*Spanish/i.test(notes)) {
    notes = [notes, "Language: Spanish"].filter(Boolean).join("\n")
  }
  if (notes !== (lead.notes ?? "")) changes.notes = notes
  return changes
}

/** Leads still linked to an event that's no longer on the calendar (deleted, or
 *  moved past the window): unlink them so Sofia stops treating them as booked.
 *  An event moved further out is linked again by phone when it comes in range. */
async function unlinkDeletedEvents(service: SupabaseClient, eventIds: string[], hoursAhead: number) {
  const now = new Date()
  const { data } = await service.from("meta_leads").select("id, calendar_event_id")
    .eq("list", "scheduled").not("calendar_event_id", "is", null)
    .gt("scheduled_at", now.toISOString())
    .lt("scheduled_at", new Date(now.getTime() + hoursAhead * 3600_000).toISOString())
  const gone = (data ?? []).filter((l) => !eventIds.includes(l.calendar_event_id as string)).map((l) => l.id)
  if (gone.length) await service.from("meta_leads").update({ calendar_event_id: null, calendar_id: null }).in("id", gone)
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

  const name = partner?.name || nameForNewLead(ev, parsed) || "Customer"
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
