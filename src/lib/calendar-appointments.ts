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
import { formatInTimeZone } from "date-fns-tz"
import { listUpcomingEvents, getEventStart, type CalendarEventSummary } from "@/lib/google-calendar"
import { parseAppointment } from "@/lib/lead-from-appointment"
import { toE164, isRealUsPhone } from "@/lib/quo-client"
import { phoneDigits, TZ } from "@/lib/retell"
import { LEAD_COLUMNS, type ScheduledLead } from "@/lib/appointments"
import { estimateCalendars } from "@/lib/pm-calendars"

export interface CalendarAppointment {
  lead:              ScheduledLead
  /** When the appointment was put on the calendar (for "they just booked"). */
  bookedAt:          string
  /** Marked confirmed on the calendar (Calendar page button / green event). */
  calendarConfirmed: boolean
}

export interface SkippedEvent { title: string; start: string | null; reason: string }

/** An appointment whose time was changed on the calendar (by hand in Google
 *  Calendar, or by editing the appointment in the CRM). lead has the new time. */
export interface MovedAppointment { lead: ScheduledLead; oldIso: string }

type Contact = { name: string | null; phone: string | null; address: string | null }

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export async function calendarAppointments(
  service: SupabaseClient,
  hoursAhead: number,
  { dry = false }: { dry?: boolean } = {},
): Promise<{ appointments: CalendarAppointment[]; skipped: SkippedEvent[]; moved: MovedAppointment[] }> {
  const calendarId = process.env.META_LEADS_MAIN_CALENDAR_ID
  if (!calendarId) throw new Error("Calendar not configured (META_LEADS_MAIN_CALENDAR_ID)")

  // David's (main) calendar plus each other salesman's own (pm-calendars.ts).
  const calendars = await estimateCalendars(service).catch(() => [{ calendarId, pm: null }])
  const calendarOf = new Map<string, string>()
  const all = (await Promise.all(calendars.map(async (c) => {
    const evs = await listUpcomingEvents(c.calendarId, { daysAhead: hoursAhead / 24, maxResults: 250 })
    for (const e of evs) calendarOf.set(e.id, c.calendarId)
    return evs
  }))).flat()
  const skipped: SkippedEvent[] = []
  // Meetings someone else invited us to (a Google Ads consultation, a supplier
  // call…) are not customer appointments: never link, text or call them.
  // Ours: the calendar itself, the CRM's service account, and every
  // @omdandevelopment.com address (the real appointments are organised by
  // info@omdandevelopment.com on the omdandevelopment@gmail.com calendar).
  const own = new Set([...calendars.map((c) => c.calendarId.toLowerCase()), (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "").toLowerCase()].filter(Boolean))
  const isOurs = (email: string) => own.has(email) || /@omdandevelopment\.com$/.test(email) || /@desertgreenbuilders\.com$/.test(email)
  const events = all.filter((e) => {
    const organizer = e.organizerEmail?.toLowerCase()
    if (!organizer || isOurs(organizer)) return true
    skipped.push({ title: e.title, start: e.start, reason: `invitation from ${organizer}, not a customer appointment` })
    return false
  })
  const ids = events.map((e) => e.id).filter(Boolean)
  const moved: MovedAppointment[] = []
  if (!dry) await unlinkDeletedEvents(service, calendarId, ids, hoursAhead, moved)
  if (!ids.length) return { appointments: [], skipped, moved }

  const [jobs, appts, metas] = await Promise.all([
    service.from("jobs").select("calendar_event_id").in("calendar_event_id", ids),
    service.from("lead_appointments").select("id, calendar_event_id, scheduled_date, start_time, end_time, customer:customers(name, phone, address)").in("calendar_event_id", ids),
    service.from("meta_leads").select(LEAD_COLUMNS).in("calendar_event_id", ids),
  ])
  const jobEvents = new Set((jobs.data ?? []).map((j) => j.calendar_event_id))
  const partnerContacts = new Map<string, Contact>()
  const crmAppointments = new Map<string, CrmAppointment>()
  for (const row of appts.data ?? []) {
    const c = one(row.customer as Contact | Contact[] | null)
    if (row.calendar_event_id && c) partnerContacts.set(row.calendar_event_id, c)
    if (row.calendar_event_id) crmAppointments.set(row.calendar_event_id, row as CrmAppointment)
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
    // Booked in the CRM: keep its appointment record on the calendar's date and time.
    const crm = crmAppointments.get(ev.id)
    if (crm && !dry) await syncCrmAppointment(service, crm, startIso, ev.end)

    const wasLinked = linked.has(ev.id)
    let lead: ScheduledLead | null = linked.get(ev.id) ?? null
    const evCalendar = calendarOf.get(ev.id) ?? calendarId
    if (!lead) lead = await linkEventToLead(service, evCalendar, ev, startIso, partnerContacts.get(ev.id) ?? null, ids, dry)
    if (!lead) { skip("no phone number on the event"); continue }
    if (!isRealUsPhone(lead.phone)) { skip(`"${lead.phone}" is not a real phone number`); continue }

    // The calendar is the schedule: its time and details win.
    const changes = changesFromEvent(lead, ev, startIso, partnerContacts.get(ev.id) ?? null)
    // Given to another salesman (event now on his calendar).
    if (lead.calendar_id !== evCalendar) changes.calendar_id = evCalendar
    if (Object.keys(changes).length) {
      if (!dry) await service.from("meta_leads").update(changes).eq("id", lead.id)
      // Same appointment, new time: the customer gets told (see handleMovedAppointment).
      if (wasLinked && changes.scheduled_at && lead.scheduled_at) moved.push({ lead: { ...lead, ...changes }, oldIso: lead.scheduled_at })
      lead = { ...lead, ...changes }
    }
    appointments.push({ lead, bookedAt: ev.created ?? lead.created_at, calendarConfirmed: ev.confirmed })
  }
  return { appointments, skipped, moved }
}

type CrmAppointment = { id: string; scheduled_date: string | null; start_time: string | null; end_time: string | null }

/** Puts the calendar's date and time on the CRM appointment (lead card, Calendar page). */
async function syncCrmAppointment(service: SupabaseClient, appt: CrmAppointment, startIso: string, endIso: string | null) {
  const start = new Date(startIso)
  const date = formatInTimeZone(start, TZ, "yyyy-MM-dd")
  const time = formatInTimeZone(start, TZ, "HH:mm")
  if (appt.scheduled_date === date && (appt.start_time ?? "").slice(0, 5) === time) return
  const end = endIso && endIso.includes("T") ? formatInTimeZone(new Date(endIso), TZ, "HH:mm") : null
  await service.from("lead_appointments")
    .update({ scheduled_date: date, start_time: time, ...(end ? { end_time: end } : {}) }).eq("id", appt.id)
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

/** Leads still linked to an event that's no longer in the window. Moved further
 *  out (still on the calendar): keep the link, take the new time and report it
 *  as moved. Deleted: unlink so Sofia stops treating them as booked. */
async function unlinkDeletedEvents(service: SupabaseClient, calendarId: string, eventIds: string[], hoursAhead: number, moved: MovedAppointment[]) {
  const now = new Date()
  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS)
    .eq("list", "scheduled").not("calendar_event_id", "is", null)
    .gt("scheduled_at", now.toISOString())
    .lt("scheduled_at", new Date(now.getTime() + hoursAhead * 3600_000).toISOString())
  const gone: string[] = []
  for (const lead of ((data ?? []) as ScheduledLead[]).filter((l) => !eventIds.includes(l.calendar_event_id as string))) {
    let current: Awaited<ReturnType<typeof getEventStart>> = null
    try { current = await getEventStart(lead.calendar_id || calendarId, lead.calendar_event_id!) }
    catch (err) { console.error("[calendar-appointments] event lookup failed:", err); continue }  // unsure: leave it alone
    if (current && new Date(current.start) > now) {
      const startIso = new Date(current.start).toISOString()
      await service.from("meta_leads").update({ scheduled_at: startIso }).eq("id", lead.id)
      const { data: crm } = await service.from("lead_appointments").select("id, scheduled_date, start_time, end_time").eq("calendar_event_id", lead.calendar_event_id!).maybeSingle()
      if (crm) await syncCrmAppointment(service, crm as CrmAppointment, startIso, current.end)
      moved.push({ lead: { ...lead, scheduled_at: startIso }, oldIso: lead.scheduled_at! })
    } else {
      gone.push(lead.id)
    }
  }
  if (gone.length) await service.from("meta_leads").update({ calendar_event_id: null, calendar_id: null }).in("id", gone)
}

/** An event that isn't linked to a meta lead yet: link it to the lead with the
 *  same phone (when that lead isn't already tied to another upcoming event), or
 *  create one. Returns null when the event has no phone number to call.
 *  dry: writes nothing (a new lead comes back with id "(new)"). */
/** The meta lead for one calendar appointment: the one linked to it, else
 *  linked now by phone (or created). Null when the event has no phone. */
export async function leadForEvent(service: SupabaseClient, calendarId: string, ev: CalendarEventSummary): Promise<ScheduledLead | null> {
  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("calendar_event_id", ev.id).maybeSingle()
  if (data) return data as ScheduledLead
  if (!ev.start?.includes("T")) return null
  return linkEventToLead(service, calendarId, ev, new Date(ev.start).toISOString(), null, [ev.id], false)
}

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
  // An account number or ID in the event text is not a phone number.
  if (!phone || !isRealUsPhone(phone)) return null
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
