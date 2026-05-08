import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { getTwilioClient, TWILIO_FROM_PHONE, TWILIO_MESSAGING_SERVICE_SID, NO_ANSWER_SMS } from "@/lib/twilio-client"

type Outcome = "no_answer" | "not_interested" | "need_follow_up" | "approved"

// Maps work-mode outcome → lead status when all phones are handled
const LEAD_STATUS_FOR_OUTCOME: Record<string, string> = {
  no_answer:      "called_no_answer",
  not_interested: "not_interested",
  need_follow_up: "need_follow_up",
  approved:       "approved",
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as {
    lead_id:      string
    phone_id:     string
    outcome:      Outcome
    call_log_id?: string
    notes?:       string
    send_sms?:    boolean  // defaults true for no_answer
  }

  const { lead_id, phone_id, outcome, call_log_id, notes } = body
  const send_sms = body.send_sms !== false  // default true

  if (!lead_id || !phone_id || !outcome) {
    return Response.json({ error: "lead_id, phone_id, outcome are required" }, { status: 400 })
  }

  const VALID: Outcome[] = ["no_answer", "not_interested", "need_follow_up", "approved"]
  if (!VALID.includes(outcome)) {
    return Response.json({ error: `Invalid outcome: ${outcome}` }, { status: 400 })
  }

  // ── 1. Fetch the current phone to get its number and attempt_count ──────────
  const { data: phone, error: phoneErr } = await supabase
    .from("propstream_lead_phones")
    .select("id, phone, attempt_count")
    .eq("id", phone_id)
    .single()

  if (phoneErr || !phone) {
    return Response.json({ error: "Phone not found" }, { status: 404 })
  }

  // ── 2. Mark phone as completed ───────────────────────────────────────────────
  await supabase
    .from("propstream_lead_phones")
    .update({
      last_called_at: new Date().toISOString(),
      attempt_count:  (phone.attempt_count ?? 0) + 1,
      last_outcome:   outcome,
      is_completed:   true,
    })
    .eq("id", phone_id)

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

  // ── 4. need_follow_up: close all other phones, set follow-up phone, done ────
  if (outcome === "need_follow_up") {
    // Mark all other active phones for this lead as completed (they won't be called)
    await supabase
      .from("propstream_lead_phones")
      .update({ is_completed: true, last_outcome: "skipped_for_followup" })
      .eq("lead_id", lead_id)
      .eq("is_active", true)
      .neq("id", phone_id)  // spare the follow-up phone the "skipped" label — it's already marked above

    const leadUpdates: Record<string, unknown> = {
      status:                     "need_follow_up",
      selected_follow_up_phone_id: phone_id,
    }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)

    return Response.json({ lead_done: true, lead_status: "need_follow_up", sms_sent: false, sms_error: null })
  }

  // ── 5. approved: mark lead status ───────────────────────────────────────────
  if (outcome === "approved") {
    const leadUpdates: Record<string, unknown> = { status: "approved" }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)

    return Response.json({ lead_done: true, lead_status: "approved", sms_sent: false, sms_error: null })
  }

  // ── 6. no_answer / not_interested: check if all phones are now complete ──────
  const { data: remainingPhones } = await supabase
    .from("propstream_lead_phones")
    .select("id, is_completed")
    .eq("lead_id", lead_id)
    .eq("is_active", true)
    .eq("is_wrong_number", false)

  const allDone = (remainingPhones ?? []).every((p) => p.is_completed)
  const newLeadStatus = allDone ? LEAD_STATUS_FOR_OUTCOME[outcome] : null

  if (newLeadStatus) {
    const leadUpdates: Record<string, unknown> = { status: newLeadStatus }
    if (notes) leadUpdates.notes = notes
    await supabase.from("propstream_leads").update(leadUpdates).eq("id", lead_id)
  }

  // ── 7. Auto-send no-answer SMS ───────────────────────────────────────────────
  let sms_sent  = false
  let sms_error: string | null = null

  if (outcome === "no_answer" && send_sms) {
    try {
      const twilio = getTwilioClient()
      const msg = await twilio.messages.create(
        TWILIO_MESSAGING_SERVICE_SID
          ? { to: phone.phone, body: NO_ANSWER_SMS, messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
          : { to: phone.phone, body: NO_ANSWER_SMS, from: TWILIO_FROM_PHONE }
      )

      await supabase.from("propstream_sms_logs").insert({
        lead_id,
        phone_id,
        call_log_id: call_log_id ?? null,
        direction:          "outbound",
        to_phone:           phone.phone,
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
    lead_done:   allDone,
    lead_status: newLeadStatus ?? null,
    sms_sent,
    sms_error,
  })
}
