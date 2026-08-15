import { NextRequest, NextResponse } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { syncJobCalendarEvent } from "@/lib/job-calendar-sync"

interface RouteCtx { params: Promise<{ id: string }> }

// POST /api/jobs/[id]/sync-calendar
// Called by the job create/edit/status client components right after a
// successful write — creates/updates/deletes the job's Google Calendar
// event to match its current scheduled_date/time/status. Split into its own
// route because the calendar sync needs the Google service account
// credentials (server-only), while the job writes themselves happen
// client-side via the browser Supabase client.
export async function POST(_req: NextRequest, { params }: RouteCtx) {
  const session = await requirePermission("jobs:edit")
  if (session instanceof Response) return session

  const { id } = await params
  const result = await syncJobCalendarEvent(id)
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 })
  return NextResponse.json({ ok: true })
}
