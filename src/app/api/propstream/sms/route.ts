import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { getTwilioClient, assertTwilioConfig, TWILIO_FROM_PHONE, TWILIO_MESSAGING_SERVICE_SID } from "@/lib/twilio-client"

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const twilioCheck = assertTwilioConfig()
  if (!twilioCheck.ok) return Response.json({ error: twilioCheck.error }, { status: 503 })

  const body = await req.json() as {
    lead_id:  string
    phone_id: string
    to_phone: string
    message:  string
  }

  const { lead_id, phone_id, to_phone, message } = body

  if (!lead_id || !phone_id || !to_phone || !message?.trim()) {
    return Response.json({ error: "lead_id, phone_id, to_phone, and message are required" }, { status: 400 })
  }

  try {
    const twilio = getTwilioClient()
    const msg = await twilio.messages.create(
      TWILIO_MESSAGING_SERVICE_SID
        ? { to: to_phone, body: message.trim(), messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID }
        : { to: to_phone, body: message.trim(), from: TWILIO_FROM_PHONE }
    )

    await supabase.from("propstream_sms_logs").insert({
      lead_id,
      phone_id,
      direction:          "outbound",
      to_phone,
      from_phone:         TWILIO_FROM_PHONE,
      body:               message.trim(),
      twilio_message_sid: msg.sid,
      status:             "sent",
      is_auto:            false,
    })

    return Response.json({ ok: true, message_sid: msg.sid })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "SMS failed"
    return Response.json({ error: message }, { status: 502 })
  }
}
