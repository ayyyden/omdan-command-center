import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { STOP_KEYWORDS } from "@/lib/twilio-client"

// Public — Twilio webhook for inbound SMS replies from leads.
export async function POST(req: NextRequest) {
  const formData = await req.formData()
  const from  = (formData.get("From")  as string | null) ?? ""
  const to    = (formData.get("To")    as string | null) ?? ""
  const body  = (formData.get("Body")  as string | null) ?? ""
  const msgSid = (formData.get("MessageSid") as string | null) ?? ""

  const supabase = createServiceClient()

  // Find a matching lead phone to associate this message
  const { data: phoneRow } = await supabase
    .from("propstream_lead_phones")
    .select("id, lead_id")
    .eq("phone", from)
    .limit(1)
    .maybeSingle()

  const lead_id  = phoneRow?.lead_id  ?? null
  const phone_id = phoneRow?.id       ?? null

  // Log the inbound SMS
  await supabase.from("propstream_sms_logs").insert({
    lead_id,
    phone_id,
    direction:          "inbound",
    to_phone:           to,
    from_phone:         from,
    body:               body,
    twilio_message_sid: msgSid,
    status:             "received",
    is_auto:            false,
  })

  // Handle STOP — mark lead as do_not_call
  const normalized = body.trim().toLowerCase().replace(/[^a-z]/g, "")
  if (STOP_KEYWORDS.has(normalized) && lead_id) {
    await supabase
      .from("propstream_leads")
      .update({ status: "do_not_call" })
      .eq("id", lead_id)
      .in("status", ["new", "called_no_answer", "callback_later", "warm_lead"])
  }

  // Return empty TwiML — no auto-reply
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
    { headers: { "Content-Type": "text/xml" } }
  )
}
