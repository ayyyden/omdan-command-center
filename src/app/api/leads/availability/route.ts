import { NextRequest, NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { bookingScriptUrl } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { nearbyAppointmentsByDay, pmOpenTimes } from "@/lib/nearby-appointments"
import { loadPms } from "@/lib/pm-calendars"

// GET /api/leads/availability?zip=92240&brand=omdan|desert_green&pm_id=…
// Open estimate times for the CRM "Add lead" form.
//   David (or no salesman picked): the same rules the website and Sofia use
//     (open days, max per day, notice, Google Calendar, drive time).
//   Another salesman: his own calendar, Sun–Thu 8 AM–7 PM (pmOpenTimes).
// Each day also lists the estimates already booked near this ZIP that day
// ("nearby", on the chosen salesman's calendar), so appointments group by area.
export async function GET(req: NextRequest) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const zip = (req.nextUrl.searchParams.get("zip") ?? "").replace(/\D/g, "").slice(0, 5)
  const brand = req.nextUrl.searchParams.get("brand") === "desert_green" ? "" : "omdan"
  const pmId = req.nextUrl.searchParams.get("pm_id")
  const service = createServiceClient()
  const pm = pmId ? (await loadPms(service)).find((p) => p.id === pmId) ?? null : null

  try {
    // Another salesman: his own open times.
    if (pm && !pm.main) {
      const [days, nearby] = await Promise.all([
        pmOpenTimes(service, pm.calendarId ?? "", zip.length === 5 ? zip : null),
        pm.calendarId && zip.length === 5 ? nearbyAppointmentsByDay(service, zip, 45, pm.calendarId).catch(() => ({})) : Promise.resolve({}),
      ])
      const n = nearby as Record<string, unknown[]>
      return NextResponse.json({
        inArea: null,
        salesman: pm.name,
        days: days.map((d) => ({ ...d, nearby: n[d.date] ?? [] })),
        nearbyByDate: n,
      })
    }

    const base = bookingScriptUrl()
    if (!base) return NextResponse.json({ error: "Booking backend not configured (BOOKING_SCRIPT_URL)" }, { status: 500 })
    const nearbyP = zip.length === 5
      ? nearbyAppointmentsByDay(service, zip).catch((e) => { console.error("[leads/availability] nearby failed:", e); return {} })
      : Promise.resolve({})
    const res = await fetch(`${base}?action=availability&brand=${brand}${zip.length === 5 ? `&zip=${zip}` : ""}`, { cache: "no-store" })
    const data = await res.json() as { ok?: boolean; inArea?: boolean; days?: { date: string; slots: { time: string }[] }[] }
    if (!data.ok) return NextResponse.json({ error: "The booking backend didn't answer" }, { status: 502 })
    const nearby: Record<string, unknown[]> = await nearbyP
    return NextResponse.json({
      inArea: data.inArea ?? null,
      days:   (data.days ?? []).map((d) => ({ date: d.date, times: d.slots.map((s) => s.time), nearby: nearby[d.date] ?? [] })).filter((d) => d.times.length),
      // Every date with an estimate nearby, open or not (for "Any day & time").
      nearbyByDate: nearby,
    })
  } catch (err) {
    console.error("[leads/availability] failed:", err)
    return NextResponse.json({ error: "Couldn't load open times" }, { status: 502 })
  }
}
