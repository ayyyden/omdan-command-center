import { NextRequest, NextResponse } from "next/server"
import { sendQuoSms } from "@/lib/quo-client"
import { speakSlot } from "@/lib/retell"

// POST /api/retell/remind
// Called once a day by the booking backend (Apps Script trigger
// sendOmdanReminders) for each Omdan estimate booked for tomorrow: texts the
// homeowner a reminder from the business Quo number. Replies land in Quo.
//
// Auth: x-website-secret = WEBSITE_LEADS_SECRET (the key the booking backend
// already uses for /api/meta-leads/website).
export async function POST(req: NextRequest) {
  const expected = process.env.WEBSITE_LEADS_SECRET
  const secret = req.headers.get("x-website-secret")
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    full_name?: string
    phone?:     string
    date?:      string   // YYYY-MM-DD
    time?:      string   // HH:mm
    address?:   string
    language?:  string
  }
  if (!body.phone || !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "") || !/^\d{2}:\d{2}$/.test(body.time ?? "")) {
    return NextResponse.json({ error: "phone, date and time are required" }, { status: 400 })
  }

  const es = /^(es|spanish)/i.test(body.language ?? "")
  const first = (body.full_name ?? "").trim().split(/\s+/)[0] || (es ? "hola" : "there")
  const when = speakSlot(body.date!, body.time!, es ? "es" : "en")
  const text = es
    ? `Omdan Development: Hola ${first}, le recordamos su estimado gratis en sitio mañana, ${when}${body.address ? ` en ${body.address}` : ""}. Responda 1 para confirmar o 2 si necesita cambiar la hora.`
    : `Omdan Development: Hi ${first}, a reminder of your free on-site estimate tomorrow, ${when}${body.address ? ` at ${body.address}` : ""}. Reply 1 to confirm or 2 if you need a different time.`

  const sms = await sendQuoSms(body.phone, text)
  if (!sms.ok) return NextResponse.json({ ok: false, error: sms.error }, { status: 502 })
  return NextResponse.json({ ok: true })
}
