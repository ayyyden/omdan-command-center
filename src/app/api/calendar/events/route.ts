import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { listUpcomingEvents } from "@/lib/google-calendar"

export interface CalendarEventWithSource {
  id:          string
  title:       string
  start:       string | null
  end:         string | null
  location:    string | null
  description: string | null
  htmlLink:    string | null
  calendar:    "main" | "callback"
  /** Customer phone — from the linked CRM record, else parsed from the description */
  phone:       string | null
}

type Contact = { phone: string | null; address: string | null }

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

// Lead-appointment events write "Phone: …" into the description; anything
// else typed into an event by hand may carry a number too.
function phoneFromText(text: string | null): string | null {
  if (!text) return null
  const m = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
  return m ? m[0].trim() : null
}

// GET /api/calendar/events?days_ahead=30
// Authenticated in-app replacement for the (rejected, correctly) public
// iframe embed — pulls events server-side through the same Google service
// account Lia's list_calendar_events tool uses, so client PII (names,
// phones, addresses — the job title IS the client's address) never leaves
// a logged-in session.
export async function GET(req: NextRequest) {
  const session = await requirePermission("scheduler:view")
  if (session instanceof Response) return session

  const daysAhead = Math.min(90, Math.max(1, parseInt(req.nextUrl.searchParams.get("days_ahead") ?? "30", 10) || 30))

  const mainId     = process.env.META_LEADS_MAIN_CALENDAR_ID
  const callbackId = process.env.META_LEADS_CALLBACK_CALENDAR_ID

  const [mainEvents, callbackEvents] = await Promise.all([
    mainId     ? listUpcomingEvents(mainId,     { daysAhead, maxResults: 100 }).catch(() => []) : Promise.resolve([]),
    callbackId ? listUpcomingEvents(callbackId, { daysAhead, maxResults: 100 }).catch(() => []) : Promise.resolve([]),
  ])

  const raw = [
    ...mainEvents.map((e) => ({ ...e, calendar: "main" as const })),
    ...callbackEvents.map((e) => ({ ...e, calendar: "callback" as const })),
  ]

  // Match each event back to the CRM record that created it (jobs, lead
  // appointments and meta leads all store their calendar_event_id) so the
  // Calendar page can show a tap-to-call phone and a tap-to-navigate address.
  // Uses the caller's own session, so RLS still decides what they can see.
  const ids = raw.map((e) => e.id).filter(Boolean)
  const contacts = new Map<string, Contact>()
  if (ids.length) {
    const { supabase } = session
    const [jobs, appts, metas] = await Promise.all([
      supabase.from("jobs").select("calendar_event_id, customer:customers(phone, address)").in("calendar_event_id", ids),
      supabase.from("lead_appointments").select("calendar_event_id, customer:customers(phone, address)").in("calendar_event_id", ids),
      supabase.from("meta_leads").select("calendar_event_id, phone, address").in("calendar_event_id", ids),
    ])
    for (const row of [...(jobs.data ?? []), ...(appts.data ?? [])]) {
      const c = one(row.customer as Contact | Contact[] | null)
      if (row.calendar_event_id && c) contacts.set(row.calendar_event_id, { phone: c.phone ?? null, address: c.address ?? null })
    }
    for (const row of metas.data ?? []) {
      if (row.calendar_event_id) contacts.set(row.calendar_event_id, { phone: row.phone ?? null, address: row.address ?? null })
    }
  }

  const events: CalendarEventWithSource[] = raw.map((e) => {
    const c = contacts.get(e.id)
    return {
      ...e,
      location: e.location || c?.address || null,
      phone:    c?.phone || phoneFromText(e.description) || null,
    }
  }).sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))

  return NextResponse.json({
    events,
    configured: { main: !!mainId, callback: !!callbackId },
  })
}
