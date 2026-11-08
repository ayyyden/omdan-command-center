import { NextRequest, NextResponse } from "next/server"
import { verifyRetellSecret, phoneDigits, speakDateTime } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { handleFollowupReply } from "@/lib/followups"
import {
  LEAD_COLUMNS, getConfirmation, markConfirmed, notifyOwner,
  leadLanguage, leadBrand, BRANDS, textCustomer, type ScheduledLead,
} from "@/lib/appointments"

// Any normal way of saying yes, from "Y" or "Confirmed" to "Yes we'll be there"
// (any capitals, any punctuation). A reply that asks for a change wins over yes.
const YES = /^\W*(1|y|yes|yea|yeah|yep|yup|ya|si|sí|confirm(s|ed|o|ado)?|ok(ay)?|k|sure|correct|absolutely|of course|claro|👍|✅)(\W|$)|\b(confirm(ed)?|(we|i)('ll| will) be (there|home)|see you)\b/i
const CHANGE = /^\W*(2|reschedule|change|cambiar|cambio|otra|another)\b|\b(reschedule|different (time|day)|another (time|day)|can'?t make it|cancel)\b/i

// POST /api/quo/inbound?secret=… — Quo webhook (message.received).
// Replies to the confirmation text: YES (or any yes) confirms the appointment,
// 2 tells the customer we'll call and alerts the owner — no automated calls.
// Any other message is left for the team in Quo as usual.
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
  // Getting follow-up texts? Any reply stops them and goes to the team.
  if (await handleFollowupReply(createServiceClient(), msg.from, text).catch(() => false)) {
    return NextResponse.json({ ok: true, action: "follow-up reply sent to the team" })
  }
  const change = CHANGE.test(text), yes = !change && YES.test(text)
  if (!yes && !change) return NextResponse.json({ ok: true, skipped: true })

  const digits = phoneDigits(msg.from)
  const service = createServiceClient()
  const now = new Date()
  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS)
    .eq("list", "scheduled").not("calendar_event_id", "is", null).gt("scheduled_at", now.toISOString())
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

  await textCustomer(lead, lead.phone!, lang === "es"
    ? `${company}: ¡Sin problema! Le llamaremos pronto para buscar otra hora.`
    : `${company}: No problem! We will call you soon to find a new time.`)
  await notifyOwner(`${lead.full_name} (${company}) replied "${text.trim().slice(0, 120)}" to the confirmation text for ${speakDateTime(lead.scheduled_at!)}. They need a different time. Please call ${lead.phone}.`)
  return NextResponse.json({ ok: true, action: "owner notified" })
}
