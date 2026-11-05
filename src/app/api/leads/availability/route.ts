import { NextRequest, NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { bookingScriptUrl } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { nearbyAppointmentsByDay } from "@/lib/nearby-appointments"

// GET /api/leads/availability?zip=92240&brand=omdan|desert_green
// Open estimate times for the CRM "Add lead" form — the same rules the website
// and Sofia use (open days, max per day, notice, Google Calendar, drive time).
// Each day also lists the estimates already booked near this ZIP that day
// ("nearby"), so the team can group appointments by area.
export async function GET(req: NextRequest) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const zip = (req.nextUrl.searchParams.get("zip") ?? "").replace(/\D/g, "").slice(0, 5)
  const brand = req.nextUrl.searchParams.get("brand") === "desert_green" ? "" : "omdan"
  const base = bookingScriptUrl()
  if (!base) return NextResponse.json({ error: "Booking backend not configured (BOOKING_SCRIPT_URL)" }, { status: 500 })

  try {
    const nearbyP = zip.length === 5
      ? nearbyAppointmentsByDay(createServiceClient(), zip).catch((e) => { console.error("[leads/availability] nearby failed:", e); return {} })
      : Promise.resolve({})
    const res = await fetch(`${base}?action=availability&brand=${brand}${zip.length === 5 ? `&zip=${zip}` : ""}`, { cache: "no-store" })
    const data = await res.json() as { ok?: boolean; inArea?: boolean; days?: { date: string; slots: { time: string }[] }[] }
    if (!data.ok) return NextResponse.json({ error: "The booking backend didn't answer" }, { status: 502 })
    const nearby: Record<string, unknown[]> = await nearbyP
    return NextResponse.json({
      inArea: data.inArea ?? null,
      days:   (data.days ?? []).map((d) => ({ date: d.date, times: d.slots.map((s) => s.time), nearby: nearby[d.date] ?? [] })).filter((d) => d.times.length),
    })
  } catch (err) {
    console.error("[leads/availability] backend failed:", err)
    return NextResponse.json({ error: "Couldn't reach the booking backend" }, { status: 502 })
  }
}
