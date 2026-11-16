// "Same area" hints for booking: which upcoming days already have an estimate
// appointment close to a new lead's ZIP, so David can do several estimates in
// one area on one day instead of driving from end to end.
//
// Appointments come from the main Google Calendar (the schedule's source of
// truth). Distance is straight-line between ZIP centres (ca-zip-centers.ts).

import type { SupabaseClient } from "@supabase/supabase-js"
import { CA_ZIP_CENTERS } from "@/lib/ca-zip-centers"
import { listUpcomingEvents, listEventsBetween } from "@/lib/google-calendar"
import { ptParts, ptInstant } from "@/lib/appointments"

/** Appointments within this many miles (straight line) count as "nearby". */
export const NEARBY_MILES = 15

export interface NearbyAppointment {
  name:  string
  city:  string | null
  time:  string        // "HH:mm" Pacific
  miles: number
}

let centers: Map<string, [number, number]> | null = null
function zipCenter(zip: string): [number, number] | null {
  if (!centers) {
    centers = new Map()
    for (const entry of CA_ZIP_CENTERS.split("|")) {
      const [z, lat, lng] = entry.split(" ")
      centers.set(z, [Number(lat), Number(lng)])
    }
  }
  return centers.get(zip) ?? null
}

export function zipMiles(a: string, b: string): number | null {
  const p = zipCenter(a), q = zipCenter(b)
  if (!p || !q) return null
  const rad = Math.PI / 180
  const dLat = (q[0] - p[0]) * rad, dLng = (q[1] - p[1]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p[0] * rad) * Math.cos(q[0] * rad) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

/** The last California ZIP in an address ("…, Riverside, CA 92503"). */
function lastZip(text: string | null | undefined): string | null {
  const all = String(text ?? "").match(/\b9[0-6]\d{3}\b/g)
  return all?.[all.length - 1] ?? null
}

function cityOf(location: string): string | null {
  const m = location.match(/,\s*([^,]+?),\s*(?:CA|California)\b/i)
  return m ? m[1].trim().replace(/\b\w/g, (c) => c.toUpperCase()) : null
}

/** "Omdan estimate: Jane Doe (Pavers)" / "Jane Doe Lead Appointment" → "Jane Doe" */
function nameOf(title: string): string {
  return title
    .replace(/^.*?(estimate|appointment)\s*:\s*/i, "")
    .replace(/\s*\(.*$/, "")
    .replace(/\s*lead appointment\s*$/i, "")
    .trim() || title
}

/**
 * Upcoming estimate appointments within NEARBY_MILES of `zip`, grouped by
 * Pacific date ("yyyy-MM-dd"), closest first. Job events and all-day events
 * are left out.
 */
export async function nearbyAppointmentsByDay(
  service: SupabaseClient,
  zip: string,
  daysAhead = 45,
  calendarId: string | undefined = process.env.META_LEADS_MAIN_CALENDAR_ID,
): Promise<Record<string, NearbyAppointment[]>> {
  if (!calendarId || !zipCenter(zip)) return {}

  const events = await listUpcomingEvents(calendarId, { daysAhead, maxResults: 250 })
  const timed = events.filter((e) => e.id && e.start?.includes("T"))
  if (!timed.length) return {}
  const { data: jobs } = await service.from("jobs").select("calendar_event_id").in("calendar_event_id", timed.map((e) => e.id))
  const jobEvents = new Set((jobs ?? []).map((j) => j.calendar_event_id))

  const byDay: Record<string, NearbyAppointment[]> = {}
  for (const ev of timed) {
    if (jobEvents.has(ev.id)) continue
    const evZip = lastZip(ev.location) ?? lastZip(ev.description)
    if (!evZip) continue
    const miles = zipMiles(zip, evZip)
    if (miles == null || miles > NEARBY_MILES) continue
    const { date, time } = ptParts(ev.start!)
    ;(byDay[date] ??= []).push({ name: nameOf(ev.title), city: ev.location ? cityOf(ev.location) : null, time, miles: Math.round(miles) })
  }
  for (const list of Object.values(byDay)) list.sort((a, b) => a.miles - b.miles || a.time.localeCompare(b.time))
  return byDay
}

// ─── Can David make it? ──────────────────────────────────────────────────────
// Before booking a time (especially "Any day & time", which skips the booking
// system's own rules): the other estimates that day, and whether the new one
// overlaps one of them or leaves too little time to drive between them.
// Drive time is a rough guess from straight-line distance between ZIP centres
// (roads ~1.2x longer, freeway speed, plus ~10 min getting in and out), so it
// warns, it doesn't block.

/** How long an estimate visit takes (the calendar event length). */
export const VISIT_MINUTES = 60

export function driveMinutes(miles: number): number {
  if (miles < 1) return 5
  return Math.round(10 + miles * 1.2)
}

export interface DayAppointment {
  name:   string
  city:   string | null
  start:  string        // "HH:mm" Pacific
  end:    string
  miles:  number | null // from the new address; null when either ZIP is unknown
}

export interface DayProblem {
  kind:    "double" | "tight"
  with:    string       // the other appointment's name
  message: string
}

const hm = (iso: string) => ptParts(iso).time
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
function clock(t: string) {
  const [h, m] = t.split(":").map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`
}

/** One day's estimates on a calendar, with distance from `zip`. */
async function dayAppointments(service: SupabaseClient, calendarId: string, fromIso: string, toIso: string, zip: string | null) {
  const events = (await listEventsBetween(calendarId, fromIso, toIso)).filter((e) => e.id && e.start?.includes("T"))
  const { data: jobs } = events.length
    ? await service.from("jobs").select("calendar_event_id").in("calendar_event_id", events.map((e) => e.id))
    : { data: [] }
  const jobEvents = new Set((jobs ?? []).map((j) => j.calendar_event_id))
  return events.filter((e) => !jobEvents.has(e.id)).map((ev) => {
    const evZip = lastZip(ev.location) ?? lastZip(ev.description)
    const miles = zip && evZip ? zipMiles(zip, evZip) : null
    const start = hm(ev.start!)
    const endMin = ev.end?.includes("T") && ptParts(ev.end).date === ptParts(ev.start!).date ? minutesOf(hm(ev.end)) : minutesOf(start) + VISIT_MINUTES
    const end = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`
    return { date: ptParts(ev.start!).date, appt: { name: nameOf(ev.title), city: ev.location ? cityOf(ev.location) : null, start, end, miles: miles == null ? null : Math.round(miles) } as DayAppointment }
  })
}

/** Double bookings and too-short drives if a new estimate starts at `time`. */
export function problemsAt(appointments: DayAppointment[], time: string): DayProblem[] {
  const problems: DayProblem[] = []
  const s = minutesOf(time), e = s + VISIT_MINUTES
  for (const a of appointments) {
    const as = minutesOf(a.start), ae = Math.max(minutesOf(a.end), as + 1)
    const where = a.city ? ` in ${a.city}` : ""
    if (s < ae && as < e) {
      problems.push({ kind: "double", with: a.name, message: `Double booking: ${a.name}${where} is ${clock(a.start)}–${clock(a.end)}.` })
      continue
    }
    if (a.miles == null) continue
    const need = driveMinutes(a.miles)
    const gap = ae <= s ? s - ae : as - e     // free minutes between the two visits
    if (gap < need) {
      const order = ae <= s ? `after ${a.name}${where} (ends ${clock(a.end)})` : `before ${a.name}${where} (starts ${clock(a.start)})`
      problems.push({ kind: "tight", with: a.name, message: `Too tight ${order}: about ${a.miles} mi, ~${need} min drive, only ${gap} min between them.` })
    }
  }
  return problems
}

export async function checkDay(
  service: SupabaseClient,
  date: string,          // yyyy-MM-dd Pacific
  time: string | null,   // HH:mm Pacific (null: just list the day)
  zip: string | null,
  calendarId: string | undefined = process.env.META_LEADS_MAIN_CALENDAR_ID,
): Promise<{ appointments: DayAppointment[]; problems: DayProblem[] }> {
  if (!calendarId) return { appointments: [], problems: [] }
  const appointments = (await dayAppointments(service, calendarId, ptInstant(date, "00:00").toISOString(), ptInstant(date, "23:59").toISOString(), zip)).map((x) => x.appt)
  return { appointments, problems: time ? problemsAt(appointments, time) : [] }
}

// ─── Open times for a salesman other than David ──────────────────────────────
// The website booking system only knows David's schedule (the main calendar).
// Another salesman works the same days and hours (Sun–Thu, hourly 8 AM–7 PM);
// a time is open when it doesn't overlap anything on his calendar and leaves
// enough time to drive to and from his other estimates that day.

export const PM_WORK_DAYS = [0, 1, 2, 3, 4]   // Sun..Thu
export const PM_WORK_TIMES = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00"]
const NOTICE_MINUTES = 120

export async function pmOpenTimes(service: SupabaseClient, calendarId: string, zip: string | null, daysAhead = 28) {
  const now = new Date()
  const today = ptParts(now.toISOString()).date
  const dates: string[] = []
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i)
    const date = d.toISOString().slice(0, 10)
    if (PM_WORK_DAYS.includes(d.getUTCDay())) dates.push(date)
  }
  if (!dates.length) return []
  // No calendar yet (never given an estimate): his whole schedule is open.
  const all = !calendarId ? [] : await dayAppointments(service, calendarId, ptInstant(dates[0], "00:00").toISOString(), ptInstant(dates[dates.length - 1], "23:59").toISOString(), zip)
  const earliest = now.getTime() + NOTICE_MINUTES * 60_000
  return dates.map((date) => {
    const appts = all.filter((x) => x.date === date).map((x) => x.appt)
    const times = PM_WORK_TIMES.filter((t) => ptInstant(date, t).getTime() >= earliest && problemsAt(appts, t).length === 0)
    return { date, times }
  }).filter((d) => d.times.length)
}
