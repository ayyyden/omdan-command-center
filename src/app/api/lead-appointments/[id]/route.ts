import { NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { syncLeadAppointmentCalendarEvent } from "@/lib/lead-appointment-calendar-sync"
import { textSalesmanChange } from "@/lib/salesman-change"

interface RouteCtx { params: Promise<{ id: string }> }

// PATCH /api/lead-appointments/[id] — update status, time, or pm
export async function PATCH(req: Request, { params }: RouteCtx) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await req.json() as {
    status?:          string
    scheduled_date?:  string | null
    start_time?:      string | null
    end_time?:        string | null
    assigned_pm_id?:  string | null
    notes?:           string | null
    /** Salesman changed: text the customer who's coming (default yes). */
    text_customer?:   boolean
  }

  const supabase = createServiceClient()
  const { data: before } = await supabase.from("lead_appointments").select("assigned_pm_id").eq("id", id).maybeSingle()
  const pmChanged = body.assigned_pm_id !== undefined && (body.assigned_pm_id ?? null) !== (before?.assigned_pm_id ?? null)

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.status          !== undefined) update.status          = body.status
  if (body.scheduled_date  !== undefined) update.scheduled_date  = body.scheduled_date
  if (body.start_time      !== undefined) update.start_time      = body.start_time
  if (body.end_time        !== undefined) update.end_time        = body.end_time
  if (body.assigned_pm_id  !== undefined) update.assigned_pm_id  = body.assigned_pm_id
  if (body.notes           !== undefined) update.notes           = body.notes

  const { error } = await supabase
    .from("lead_appointments")
    .update(update)
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // A new salesman moves the event to his calendar (pm-calendars.ts), which
  // opens the old salesman's time for booking.
  let calendarError: string | null = null
  if (pmChanged || body.status !== undefined || body.scheduled_date !== undefined || body.start_time !== undefined) {
    try {
      const r = await syncLeadAppointmentCalendarEvent(id)
      if (!r.ok) calendarError = r.error
    } catch (err) {
      console.error("[lead-appointments] calendar sync failed:", err)
      calendarError = String(err)
    }
  }

  let text: string | null = null
  if (pmChanged && body.text_customer !== false) {
    text = await textSalesmanChange(supabase, id).catch((err) => `failed: ${err}`)
  }

  return NextResponse.json({ success: true, calendarError, text })
}
