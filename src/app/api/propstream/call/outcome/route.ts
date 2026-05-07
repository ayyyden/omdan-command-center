import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { getTwilioClient, TWILIO_FROM_PHONE, TWILIO_MESSAGING_SERVICE_SID, NO_ANSWER_SMS } from "@/lib/twilio-client"

const STATUS_FOR_OUTCOME: Record<string, string> = {
  no_answer:      "called_no_answer",
  not_interested: "not_interested",
  warm_lead:      "warm_lead",
  approved:       "approved",
  do_not_call:    "do_not_call",
  wrong_number:   "called_no_answer",  // phone stays, lead not progressed
  callback_later: "callback_later",
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as {
    call_log_id:      string
    lead_id:          string
    phone_id:         string
    to_phone:         string
    outcome:          string
    notes?:           string
    duration_seconds?: number
    next_follow_up_at?: string | null
    send_no_answer_sms?: boolean
  }

  const {
    call_log_id, lead_id, phone_id, to_phone, outcome,
    notes, duration_seconds, next_follow_up_at,
    send_no_answer_sms = true,
  } = body

  if (!call_log_id || !lead_id || !phone_id || !to_phone || !outcome) {
    return Response.json({ error: "call_log_id, lead_id, phone_id, to_phone, and outcome are required" }, { status: 400 })
  }

  const newLeadStatus = STATUS_FOR_OUTCOME[outcome]

  // Update call log
  await supabase
    .from("propstream_call_logs")
    .update({
      outcome,
      status: "completed",
      ended_at: new Date().toISOString(),
      ...(notes            !== undefined ? { notes }            : {}),
      ...(duration_seconds !== undefined ? { duration_seconds } : {}),
    })
    .eq("id", call_log_id)

  // Mark phone wrong if outcome is wrong_number
  if (outcome === "wrong_number") {
    await supabase
      .from("propstream_lead_phones")
      .update({ is_wrong_number: true, is_active: false })
      .eq("id", phone_id)
  }

  // Update lead status
  if (newLeadStatus) {
    const leadUpdate: Record<string, unknown> = { status: newLeadStatus }
    if (next_follow_up_at !== undefined) leadUpdate.next_follow_up_at = next_follow_up_at
    await supabase.from("propstream_leads").update(leadUpdate).eq("id", lead_id)
  }

  // Auto-send SMS on no_answer
  let smsSid: string | null = null
  if (outcome === "no_answer" && send_no_answer_sms) {
    try {
      const twilio = getTwilioClient()
      const msg = await twilio.messages.create(
        TWILIO_MESSAGING_SERVICE_SID
          ? { to: to_phone, body: NO_ANSWER_SMS, messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
          : { to: to_phone, body: NO_ANSWER_SMS, from: TWILIO_FROM_PHONE }
      )
      smsSid = msg.sid

      await supabase.from("propstream_sms_logs").insert({
        lead_id,
        phone_id,
        call_log_id,
        direction:          "outbound",
        to_phone,
        from_phone:         TWILIO_FROM_PHONE,
        body:               NO_ANSWER_SMS,
        twilio_message_sid: msg.sid,
        status:             "sent",
        is_auto:            true,
      })
    } catch {
      // SMS failure is non-fatal — outcome is still recorded
    }
  }

  return Response.json({ ok: true, sms_sid: smsSid })
}
