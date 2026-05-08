import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { getTwilioClient, TWILIO_FROM_PHONE, TWILIO_MESSAGING_SERVICE_SID, NO_ANSWER_SMS } from "@/lib/twilio-client"

// Canonical outcome handler for all PropStream calling surfaces
// (Start Work mode and main Lead Center Call Workspace both use this route).

type Outcome =
  | "no_answer" | "not_interested" | "need_follow_up" | "approved"
  | "warm_lead" | "do_not_call" | "wrong_number" | "callback_later"

const VALID_OUTCOMES = new Set<string>([
  "no_answer", "not_interested", "need_follow_up", "approved",
  "warm_lead", "do_not_call", "wrong_number", "callback_later",
])

// Outcomes that mark the lead done immediately, regardless of remaining phones.
const LEAD_DONE_IMMEDIATELY = new Set<Outcome>([
  "need_follow_up", "approved", "warm_lead", "do_not_call",
])

const LEAD_STATUS: Record<Outcome, string> = {
  no_answer:      "called_no_answer",
  not_interested: "not_interested",
  need_follow_up: "need_follow_up",
  approved:       "approved",
  warm_lead:      "warm_lead",
  do_not_call:    "do_not_call",
  wrong_number:   "called_no_answer",
  callback_later: "callback_later",
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as {
    lead_id:             string
    phone_id:            string
    outcome:             string
    call_log_id?:        string
    to_phone?:           string  // optional — looked up from phone_id if absent
    notes?:              string
    send_no_answer_sms?: boolean  // default true
  }

  const { lead_id, phone_id, call_log_id, notes } = body
  const outcome = body.outcome as Outcome
  const sendSms = body.send_no_answer_sms !== false

  if (!lead_id || !phone_id || !outcome) {
    return Response.json({ error: "lead_id, phone_id, outcome are required" }, { status: 400 })
  }
  if (!VALID_OUTCOMES.has(outcome)) {
    return Response.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 })
  }

  // ── 1. Fetch phone record ────────────────────────────────────────────────────
  const { data: phone } = await supabase
    .from("propstream_lead_phones")
    .select("id, phone, attempt_count")
    .eq("id", phone_id)
    .single()

  if (!phone) return Response.json({ error: "Phone not found" }, { status: 404 })

  const toPhone = body.to_phone ?? phone.phone

  // ── 2. Phone-level tracking ──────────────────────────────────────────────────
  if (outcome === "wrong_number") {
    // Deactivate the phone — it no longer participates in the work queue
    await supabase
      .from("propstream_lead_phones")
      .update({
        is_wrong_number: true,
        is_active:       false,
        last_called_at:  new Date().toISOString(),
        attempt_count:   (phone.attempt_count ?? 0) + 1,
        last_outcome:    "wrong_number",
      })
      .eq("id", phone_id)
  } else {
    await supabase
      .from("propstream_lead_phones")
      .update({
        last_called_at: new Date().toISOString(),
        attempt_count:  (phone.attempt_count ?? 0) + 1,
        last_outcome:   outcome,
        is_completed:   true,
      })
      .eq("id", phone_id)
  }

  // ── 3. Update call log if provided ───────────────────────────────────────────
  if (call_log_id) {
    await supabase
      .from("propstream_call_logs")
      .update({
        outcome,
        status:   "completed",
        ended_at: new Date().toISOString(),
        ...(notes ? { notes } : {}),
      })
      .eq("id", call_log_id)
  }

  // ── 4. need_follow_up: close all other phones, set follow-up phone ───────────
  if (outcome === "need_follow_up") {
    await supabase
      .from("propstream_lead_phones")
      .update({ is_completed: true, last_outcome: "skipped_for_followup" })
      .eq("lead_id", lead_id)
      .eq("is_active", true)
      .neq("id", phone_id)

    const leadUpdates: Record<string, unknown> = {
      status:                      "need_follow_up",
      selected_follow_up_phone_id: phone_id,
    }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)

    return Response.json({
      lead_done:     true,
      lead_status:   "need_follow_up",
      next_phone_id: null,
      sms_sent:      false,
      sms_error:     null,
    })
  }

  // ── 5. Outcomes that end the lead immediately ────────────────────────────────
  if (LEAD_DONE_IMMEDIATELY.has(outcome)) {
    const leadUpdates: Record<string, unknown> = { status: LEAD_STATUS[outcome] }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)

    return Response.json({
      lead_done:     true,
      lead_status:   LEAD_STATUS[outcome],
      next_phone_id: null,
      sms_sent:      false,
      sms_error:     null,
    })
  }

  // ── 6. no_answer / not_interested / callback_later / wrong_number ────────────
  //       Check remaining workable phones to determine lead_done.
  const { data: allPhones } = await supabase
    .from("propstream_lead_phones")
    .select("id, is_completed, is_active, is_wrong_number, position")
    .eq("lead_id", lead_id)
    .eq("is_active", true)
    .order("position", { ascending: true })

  const workable    = (allPhones ?? []).filter((p) => !p.is_wrong_number)
  const allDone     = workable.every((p) => p.is_completed)
  const nextPhone   = workable.find((p) => !p.is_completed && p.id !== phone_id) ?? null

  if (allDone) {
    const leadUpdates: Record<string, unknown> = { status: LEAD_STATUS[outcome] }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)
  } else if (notes) {
    await supabase.from("propstream_leads").update({ notes }).eq("id", lead_id)
  }

  // ── 7. Auto-send no-answer SMS ───────────────────────────────────────────────
  let sms_sent  = false
  let sms_error: string | null = null

  if (outcome === "no_answer" && sendSms) {
    try {
      const twilio = getTwilioClient()
      const msg = await twilio.messages.create(
        TWILIO_MESSAGING_SERVICE_SID
          ? { to: toPhone, body: NO_ANSWER_SMS, messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
          : { to: toPhone, body: NO_ANSWER_SMS, from: TWILIO_FROM_PHONE }
      )

      await supabase.from("propstream_sms_logs").insert({
        lead_id,
        phone_id,
        call_log_id:        call_log_id ?? null,
        direction:          "outbound",
        to_phone:           toPhone,
        from_phone:         TWILIO_FROM_PHONE,
        body:               NO_ANSWER_SMS,
        twilio_message_sid: msg.sid,
        status:             "sent",
        is_auto:            true,
      })

      sms_sent = true
    } catch (err: unknown) {
      sms_error = err instanceof Error ? err.message : "SMS failed"
    }
  }

  return Response.json({
    lead_done:     allDone,
    lead_status:   allDone ? LEAD_STATUS[outcome] : null,
    next_phone_id: nextPhone?.id ?? null,
    sms_sent,
    sms_error,
  })
}
