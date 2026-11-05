// "Same area" hints for booking: which upcoming days already have an estimate
// appointment close to a new lead's ZIP, so David can do several estimates in
// one area on one day instead of driving from end to end.
//
// Appointments come from the main Google Calendar (the schedule's source of
// truth). Distance is straight-line between ZIP centres (ca-zip-centers.ts).

import type { SupabaseClient } from "@supabase/supabase-js"
import { CA_ZIP_CENTERS } from "@/lib/ca-zip-centers"
import { listUpcomingEvents } from "@/lib/google-calendar"
import { ptParts } from "@/lib/appointments"

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
): Promise<Record<string, NearbyAppointment[]>> {
  const calendarId = process.env.META_LEADS_MAIN_CALENDAR_ID
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
