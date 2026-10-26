import { NextRequest, NextResponse } from "next/server"
import { verifyRetellSecret, phoneDigits, speakDateTime } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import {
  LEAD_COLUMNS, getConfirmation, markConfirmed, startConfirmationCall, notifyOwner, ptParts,
  leadLanguage, leadBrand, BRANDS, textCustomer, type ScheduledLead,
} from "@/lib/appointments"

const YES = /^\s*(1|y|yes|yeah|yep|yup|si|sí|confirm(ed|o|ado)?|ok(ay)?|👍)\b/i
const CHANGE = /^\s*(2|reschedule|change|cambiar|cambio|otra|another)\b/i

// POST /api/quo/inbound?secret=… — Quo webhook (message.received).
// Replies to the confirmation text: YES/1 confirms the appointment,
// 2 gets a call from Sofia to pick a new time. Any other message is left
// for the team in Quo as usual.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as {
    type?: string
    data?: { object?: { from?: string; direction?: string; text?: string; body?: string } }
  }
  const msg = body.data?.object
  if (body.type !== "message.received" || !msg?.from || msg.direction === "outgoing") return NextResponse.json({ ok: true, skipped: true })
  const text = String(msg.text ?? msg.body ?? "")
  const yes = YES.test(text), change = !yes && CHANGE.test(text)
  if (!yes && !change) return NextResponse.json({ ok: true, skipped: true })

  const digits = phoneDigits(msg.from)
  const service = createServiceClient()
  const now = new Date()
  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS)
    .eq("list", "scheduled").gt("scheduled_at", now.toISOString())
    .lt("scheduled_at", new Date(now.getTime() + 72 * 3600_000).toISOString())
    .ilike("phone", `%${digits.slice(-4)}%`).order("scheduled_at")
  const lead = ((data ?? []) as ScheduledLead[]).find((l) => phoneDigits(l.phone) === digits)
  if (!lead) return NextResponse.json({ ok: true, skipped: true, reason: "no upcoming appointment" })

  const row = await getConfirmation(service, lead)
  // Only answer people we actually asked to confirm.
  if (!row || row.status !== "pending" || (!row.text_sent_at && !row.first_call_at)) {
    return NextResponse.json({ ok: true, skipped: true, reason: "not awaiting confirmation" })
  }
  const lang = leadLanguage(lead)
  const company = BRANDS[leadBrand(lead)].name

  if (yes) {
    await markConfirmed(service, lead, "text reply")
    await textCustomer(lead, lead.phone!, lang === "es"
      ? `${company}: ¡Gracias! Su estimado del ${speakDateTime(lead.scheduled_at!, "es")} está confirmado. ¡Nos vemos!`
      : `${company}: Thank you! Your estimate on ${speakDateTime(lead.scheduled_at!)} is confirmed. See you then!`)
    return NextResponse.json({ ok: true, action: "confirmed" })
  }

  const mins = Number(ptParts(now.toISOString()).time.slice(0, 2)) * 60 + Number(ptParts(now.toISOString()).time.slice(3))
  const canCall = mins >= 8 * 60 && mins <= 20 * 60
  await textCustomer(lead, lead.phone!, lang === "es"
    ? `${company}: ¡Sin problema! ${canCall ? "Le llamamos en un momento" : "Le llamamos en la mañana"} para buscar otra hora.`
    : `${company}: No problem! ${canCall ? "We'll call you in a moment" : "We'll call you in the morning"} to find a new time.`)
  if (canCall) {
    const call = await startConfirmationCall(lead, row, "reschedule_request")
    if (call.ok) return NextResponse.json({ ok: true, action: "reschedule call" })
  }
  await notifyOwner(`${lead.full_name} (${company}) replied that they need a different time for ${speakDateTime(lead.scheduled_at!)}. Please call ${lead.phone}.`)
  return NextResponse.json({ ok: true, action: "owner notified" })
}
