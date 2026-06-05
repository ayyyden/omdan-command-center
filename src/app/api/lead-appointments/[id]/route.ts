import { NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

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
  }

  const supabase = createServiceClient()

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
  return NextResponse.json({ success: true })
}
