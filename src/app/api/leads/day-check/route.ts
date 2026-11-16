import { NextRequest, NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { checkDay } from "@/lib/nearby-appointments"
import { loadPms, mainCalendarId } from "@/lib/pm-calendars"

// GET /api/leads/day-check?date=2026-11-26&time=10:00&zip=92201&pm_id=…
// (pm_id: check that salesman's calendar; David / none: the main calendar)
// For the Add lead form: the other estimates that day, and a warning when the
// new time double-books David or leaves too little time to drive between them.
export async function GET(req: NextRequest) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const p = req.nextUrl.searchParams
  const date = p.get("date") ?? ""
  const time = p.get("time") ?? ""
  const zip = (p.get("zip") ?? "").replace(/\D/g, "").slice(0, 5)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: "date is required" }, { status: 400 })
  try {
    const service = createServiceClient()
    const pmId = p.get("pm_id")
    const pm = pmId ? (await loadPms(service)).find((x) => x.id === pmId) : null
    const calendarId = pm && !pm.main ? pm.calendarId : mainCalendarId()
    // A salesman with no calendar yet has nothing booked.
    if (!calendarId) return NextResponse.json({ appointments: [], problems: [] })
    return NextResponse.json(await checkDay(service, date, /^\d{2}:\d{2}$/.test(time) ? time : null, zip.length === 5 ? zip : null, calendarId))
  } catch (err) {
    console.error("[leads/day-check] failed:", err)
    return NextResponse.json({ error: "Couldn't read the calendar for that day" }, { status: 502 })
  }
}
