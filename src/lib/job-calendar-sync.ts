// Keeps a job's Google Calendar event in sync with its schedule — called
// after every write that can change a job's scheduled_date/time/status
// (both the client-side job dialogs, via /api/jobs/[id]/sync-calendar, and
// Lia's create_job/update_job, which call this directly server-side).
// Same calendar as everything else (META_LEADS_MAIN_CALENDAR_ID) — one
// calendar, one place to look, per the Scheduler-page replacement.

import { createServiceClient } from "@/lib/supabase/service"
import { createAppointmentEvent, updateCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"
import { fromZonedTime } from "date-fns-tz"

const TERMINAL_STATUSES = new Set(["completed", "cancelled"])

export async function syncJobCalendarEvent(jobId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const calendarId = process.env.META_LEADS_MAIN_CALENDAR_ID
  if (!calendarId) return { ok: false, error: "Calendar not configured (META_LEADS_MAIN_CALENDAR_ID)" }

  const service = createServiceClient()
  const { data: job, error } = await service
    .from("jobs")
    .select("id, title, scheduled_date, scheduled_time, estimated_duration_minutes, status, calendar_event_id, calendar_id, customer:customers(address)")
    .eq("id", jobId)
    .single()

  if (error || !job) return { ok: false, error: error?.message ?? "Job not found" }

  const shouldHaveEvent = !!job.scheduled_date && !TERMINAL_STATUSES.has(job.status)

  if (!shouldHaveEvent) {
    if (job.calendar_event_id && job.calendar_id) {
      try {
        await deleteCalendarEvent(job.calendar_id, job.calendar_event_id)
      } catch (err) {
        console.error(`[job-calendar-sync] delete failed for job ${jobId}:`, err)
      }
      await service.from("jobs").update({ calendar_event_id: null, calendar_id: null }).eq("id", jobId)
    }
    return { ok: true }
  }

  let startISO: string
  try {
    startISO = fromZonedTime(`${job.scheduled_date}T${job.scheduled_time ?? "09:00"}:00`, "America/Los_Angeles").toISOString()
  } catch {
    return { ok: false, error: "Invalid scheduled_date/scheduled_time" }
  }

  const customer = job.customer as { address?: string | null } | { address?: string | null }[] | null
  const address = Array.isArray(customer) ? (customer[0]?.address ?? null) : (customer?.address ?? null)

  const input = {
    title:           job.title,
    location:        address,
    startISO,
    durationMinutes: job.estimated_duration_minutes ?? 120,
  }

  try {
    if (job.calendar_event_id && job.calendar_id === calendarId) {
      await updateCalendarEvent(calendarId, job.calendar_event_id, input)
    } else {
      const result = await createAppointmentEvent(calendarId, input)
      await service.from("jobs").update({ calendar_event_id: result.eventId, calendar_id: calendarId }).eq("id", jobId)
    }
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[job-calendar-sync] sync failed for job ${jobId}:`, message)
    return { ok: false, error: message }
  }
}
