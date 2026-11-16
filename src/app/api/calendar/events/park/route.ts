import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { leadForEvent } from "@/lib/calendar-appointments"
import { parkLead } from "@/lib/park-lead"
import { calendarOfEvent } from "@/lib/pm-calendars"
import { parseAppointment } from "@/lib/lead-from-appointment"
import type { ScheduledLead } from "@/lib/appointments"

// POST /api/calendar/events/park { event_id, list: "follow_up" | "on_hold", note?, follow_up_at? }
// Scheduler page: "Follow up later" / "Put on hold" on an appointment. The
// customer moves to that list on the Leads page and the appointment comes off
// the Google Calendar and the booking sheet, so the spot is open to book.
// No text goes to the customer. Main calendar only.
export async function POST(req: NextRequest) {
  const session = await requirePermission("scheduler:edit")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => null) as { event_id?: unknown; list?: unknown; note?: unknown; follow_up_at?: unknown; pm_id?: unknown } | null
  const eventId = typeof body?.event_id === "string" ? body.event_id : ""
  const list = body?.list === "on_hold" || body?.list === "follow_up" ? body.list : null
  if (!eventId || !list) return NextResponse.json({ error: "event_id and list are required" }, { status: 400 })
  const followUpAt = typeof body?.follow_up_at === "string" && body.follow_up_at ? new Date(body.follow_up_at) : null
  if (followUpAt && Number.isNaN(followUpAt.getTime())) return NextResponse.json({ error: "Invalid follow-up date" }, { status: 400 })
  const note = typeof body?.note === "string" ? body.note : null

  const service = createServiceClient()
  // David's (main) calendar, or the salesman's whose calendar it's on.
  const calendarId = await calendarOfEvent(service, "main", typeof body?.pm_id === "string" ? body.pm_id : null)
  if (!calendarId) return NextResponse.json({ error: "Calendar not configured" }, { status: 500 })

  // Lists need migration 067 — check before anything is deleted.
  const probe = await service.from("meta_leads").select("follow_up_at").limit(1)
  if (probe.error) return NextResponse.json({ error: "Run migration 067 in Supabase first (On Hold / Follow-up lists)." }, { status: 500 })

  try {
    const ev = await getEvent(calendarId, eventId)
    if (!ev) return NextResponse.json({ error: "That appointment is no longer on the calendar." }, { status: 404 })

    let lead: ScheduledLead | null = await leadForEvent(service, calendarId, ev)
    if (!lead) {
      // No phone number on the event: still track them by name, then free the spot.
      const parsed = parseAppointment(ev)
      const { data, error } = await service.from("meta_leads").insert({
        full_name: (parsed.name ?? ev.title).replace(/^.*?:\s*/, "").replace(/\s*Lead Appointment\s*$/i, "").trim() || ev.title,
        address:   parsed.address ?? ev.location,
        email:     parsed.email,
        raw_paste: `Calendar event ${ev.id}`,
        notes:     [`Source: Google Calendar ("${ev.title.trim()}")`, (ev.description ?? "").replace(/<[^>]+>/g, " ").trim()].filter(Boolean).join("\n"),
        list:      "scheduled",
        scheduled_at: ev.start?.includes("T") ? new Date(ev.start).toISOString() : null,
        calendar_event_id: ev.id,
        calendar_id: calendarId,
      }).select("id, full_name, phone, address, city, scheduled_at, calendar_event_id, calendar_id, notes, list, created_at").single()
      if (error || !data) {
        // Couldn't even make a lead: don't delete the appointment.
        return NextResponse.json({ error: `Couldn't add them to the list: ${error?.message ?? "unknown error"}` }, { status: 500 })
      }
      lead = data as unknown as ScheduledLead
    }

    // Moved on the calendar in the last few minutes (before the sync caught up):
    // the sheet row is found by the time on the calendar now.
    const startIso = ev.start?.includes("T") ? new Date(ev.start).toISOString() : null
    if (startIso && lead!.scheduled_at && new Date(lead!.scheduled_at).getTime() !== new Date(startIso).getTime()) {
      await service.from("meta_leads").update({ scheduled_at: startIso }).eq("id", lead!.id)
    }

    const r = await parkLead(service, lead!.id, list, { note, followUpAt })
    if (!r.ok) {
      // parkLead deletes the event itself; make sure a failure there is reported as-is.
      return NextResponse.json({ error: r.error }, { status: r.status })
    }
    // Belt and braces: the event linked to the lead was the one removed; if the
    // lead had been linked to a different event, this one still has to go.
    if ((await getEvent(calendarId, eventId))) await deleteCalendarEvent(calendarId, eventId)
    return NextResponse.json({ ok: true, lead: r.lead })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[calendar/park] failed:", message)
    return NextResponse.json({ error: `Couldn't move the appointment: ${message}` }, { status: 502 })
  }
}
