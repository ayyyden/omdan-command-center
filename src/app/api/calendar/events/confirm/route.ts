import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { setEventConfirmed } from "@/lib/google-calendar"
import { ensureLeadFromAppointment, type LeadResult } from "@/lib/lead-from-appointment"

// POST /api/calendar/events/confirm  { event_id, calendar: "main" | "callback", confirmed }
// Calendar page's Confirmed / Not confirmed toggle. Takes the calendar by
// name, never a raw calendar id, so only the CRM's own calendars can be touched.
// Confirming also adds the person to the Leads page as a New Lead (once —
// see lead-from-appointment.ts). Un-confirming leaves the lead in place.
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
    const event = await setEventConfirmed(calendarId, eventId, body.confirmed)

    // The confirmation itself is saved; a lead problem is reported, not fatal.
    let lead: LeadResult | null = null
    if (body.confirmed && which === "main") {
      lead = await ensureLeadFromAppointment(session.supabase, session.userId, event)
        .catch((err): LeadResult => ({ status: "skipped", reason: err instanceof Error ? err.message : String(err) }))
    }
    return NextResponse.json({ ok: true, confirmed: body.confirmed, lead })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[calendar/confirm] failed:", message)
    return NextResponse.json({ error: `Couldn't update the appointment: ${message}` }, { status: 502 })
  }
}
