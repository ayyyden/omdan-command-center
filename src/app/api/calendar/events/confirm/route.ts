import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { setEventConfirmed } from "@/lib/google-calendar"

// POST /api/calendar/events/confirm  { event_id, calendar: "main" | "callback", confirmed }
// Calendar page's Confirmed / Not confirmed toggle. Takes the calendar by
// name, never a raw calendar id, so only the CRM's own calendars can be touched.
export async function POST(req: NextRequest) {
  const session = await requirePermission("scheduler:edit")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => null) as { event_id?: unknown; calendar?: unknown; confirmed?: unknown } | null
  const eventId = typeof body?.event_id === "string" ? body.event_id : ""
  const which = body?.calendar === "callback" ? "callback" : body?.calendar === "main" ? "main" : null
  if (!eventId || !which || typeof body?.confirmed !== "boolean") {
    return NextResponse.json({ error: "event_id, calendar and confirmed are required" }, { status: 400 })
  }

  const calendarId = which === "main" ? process.env.META_LEADS_MAIN_CALENDAR_ID : process.env.META_LEADS_CALLBACK_CALENDAR_ID
  if (!calendarId) return NextResponse.json({ error: "Calendar not configured" }, { status: 500 })

  try {
    await setEventConfirmed(calendarId, eventId, body.confirmed)
    return NextResponse.json({ ok: true, confirmed: body.confirmed })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[calendar/confirm] failed:", message)
    return NextResponse.json({ error: `Couldn't update the appointment: ${message}` }, { status: 502 })
  }
}
