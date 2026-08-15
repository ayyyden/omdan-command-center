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

  const events: CalendarEventWithSource[] = [
    ...mainEvents.map((e) => ({ ...e, calendar: "main" as const })),
    ...callbackEvents.map((e) => ({ ...e, calendar: "callback" as const })),
  ].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? ""))

  return NextResponse.json({
    events,
    configured: { main: !!mainId, callback: !!callbackId },
  })
}
