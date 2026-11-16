import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getEvent, moveEventToCalendar } from "@/lib/google-calendar"
import { calendarForPm, calendarOfEvent, loadPms, pmFirstName } from "@/lib/pm-calendars"
import { addLeadNote, LEAD_COLUMNS, ptParts, type ScheduledLead } from "@/lib/appointments"
import { sendSalesmanChange } from "@/lib/salesman-change"
import { parseAppointment } from "@/lib/lead-from-appointment"

// POST /api/calendar/events/assign { event_id, from_pm_id, to_pm_id, text_customer }
// Scheduler page "Who goes": gives an estimate to another salesman. Its event
// moves to his Google Calendar (David's = the main calendar the website reads),
// so the old salesman's time opens up for booking. The customer gets a text
// with the new name unless text_customer is false.
export async function POST(req: NextRequest) {
  const session = await requirePermission("scheduler:edit")
  if (session instanceof Response) return session
  const body = await req.json().catch(() => null) as { event_id?: unknown; from_pm_id?: unknown; to_pm_id?: unknown; text_customer?: unknown } | null
  const eventId = typeof body?.event_id === "string" ? body.event_id : ""
  const fromPm = typeof body?.from_pm_id === "string" ? body.from_pm_id : null
  const toPm = typeof body?.to_pm_id === "string" ? body.to_pm_id : null
  if (!eventId || !toPm) return NextResponse.json({ error: "event_id and to_pm_id are required" }, { status: 400 })

  const service = createServiceClient()
  const probe = await service.from("project_managers").select("calendar_id").limit(1)
  if (probe.error) return NextResponse.json({ error: "Run migration 068 in Supabase first (a calendar per salesman)." }, { status: 500 })
  const to = (await loadPms(service)).find((p) => p.id === toPm)
  if (!to) return NextResponse.json({ error: "Unknown salesman" }, { status: 400 })

  try {
    const fromCal = await calendarOfEvent(service, "main", fromPm)
    if (!fromCal) return NextResponse.json({ error: "Calendar not configured" }, { status: 500 })
    const ev = await getEvent(fromCal, eventId)
    if (!ev) return NextResponse.json({ error: "That appointment is no longer on the calendar." }, { status: 404 })
    const toCal = await calendarForPm(service, to.id)
    const newId = toCal === fromCal ? eventId : await moveEventToCalendar(fromCal, eventId, toCal)

    // Keep the CRM records pointing at the event where it is now.
    const { data: leadRow } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("calendar_event_id", eventId).maybeSingle()
    const lead = leadRow as ScheduledLead | null
    await service.from("meta_leads").update({ calendar_event_id: newId, calendar_id: toCal }).eq("calendar_event_id", eventId)
    const { data: appt } = await service.from("lead_appointments")
      .update({ calendar_event_id: newId, calendar_id: toCal, assigned_pm_id: to.id })
      .eq("calendar_event_id", eventId).select("notes, customer:customers(name, phone)").maybeSingle()
    if (lead) await addLeadNote(service, lead, `Estimate given to ${to.name}`)

    let text: string | null = null
    if (body?.text_customer !== false && ev.start?.includes("T")) {
      const customer = appt ? ((Array.isArray(appt.customer) ? appt.customer[0] : appt.customer) as { name: string | null; phone: string | null } | null) : null
      const parsed = parseAppointment(ev)
      const { date, time } = ptParts(new Date(ev.start).toISOString())
      text = await sendSalesmanChange({
        phone:    lead?.phone ?? customer?.phone ?? parsed.phone ?? null,
        fullName: lead?.full_name ?? customer?.name ?? parsed.name ?? "",
        notes:    lead?.notes ?? (appt?.notes as string | null) ?? ev.description,
        date, time, pmName: to.name,
      })
    }
    return NextResponse.json({ ok: true, event_id: newId, pm_id: to.id, who: pmFirstName(to.name), text })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[calendar/assign] failed:", message)
    return NextResponse.json({ error: `Couldn't move the appointment: ${message}` }, { status: 502 })
  }
}
