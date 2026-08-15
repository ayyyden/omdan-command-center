// Keeps a lead appointment's Google Calendar event in sync — mirrors
// job-calendar-sync.ts. Title matches the meta-lead convention:
// "{name} Lead Appointment".

import { createServiceClient } from "@/lib/supabase/service"
import { createAppointmentEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { fromZonedTime } from "date-fns-tz"

export async function syncLeadAppointmentCalendarEvent(appointmentId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const calendarId = process.env.META_LEADS_MAIN_CALENDAR_ID
  if (!calendarId) return { ok: false, error: "Calendar not configured (META_LEADS_MAIN_CALENDAR_ID)" }

  const service = createServiceClient()
  const { data: appt, error } = await service
    .from("lead_appointments")
    .select("id, scheduled_date, start_time, status, calendar_event_id, calendar_id, project_summary, notes, customer:customers(name, address, phone)")
    .eq("id", appointmentId)
    .single()

  if (error || !appt) return { ok: false, error: error?.message ?? "Appointment not found" }

  const customer = appt.customer as { name?: string | null; address?: string | null; phone?: string | null } | { name?: string | null; address?: string | null; phone?: string | null }[] | null
  const c = Array.isArray(customer) ? customer[0] : customer

  const shouldHaveEvent = !!appt.scheduled_date && appt.status !== "cancelled"

  if (!shouldHaveEvent) {
    if (appt.calendar_event_id && appt.calendar_id) {
      try {
        await deleteCalendarEvent(appt.calendar_id, appt.calendar_event_id)
      } catch (err) {
        console.error(`[lead-appt-calendar-sync] delete failed for ${appointmentId}:`, err)
      }
      await service.from("lead_appointments").update({ calendar_event_id: null, calendar_id: null }).eq("id", appointmentId)
    }
    return { ok: true }
  }

  let startISO: string
  try {
    startISO = fromZonedTime(`${appt.scheduled_date}T${appt.start_time ?? "09:00"}:00`, "America/Los_Angeles").toISOString()
  } catch {
    return { ok: false, error: "Invalid scheduled_date/start_time" }
  }

  const description = [
    c?.phone   ? `Phone: ${c.phone}`   : null,
    appt.project_summary ? `Project: ${appt.project_summary}` : null,
    appt.notes ? appt.notes : null,
  ].filter(Boolean).join("\n")

  const input = {
    title:           `${c?.name ?? "Lead"} Lead Appointment`,
    location:        c?.address ?? null,
    description:     description || null,
    startISO,
    durationMinutes: 60,
  }

  try {
    if (appt.calendar_event_id && appt.calendar_id === calendarId) {
      await updateCalendarEvent(calendarId, appt.calendar_event_id, input)
    } else {
      const result = await createAppointmentEvent(calendarId, input)
      await service.from("lead_appointments").update({ calendar_event_id: result.eventId, calendar_id: calendarId }).eq("id", appointmentId)
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[lead-appt-calendar-sync] sync failed for ${appointmentId}:`, message)
    return { ok: false, error: message }
  }
}
