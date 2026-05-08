import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getTwilioClient, assertTwilioConfig, TWILIO_FROM_PHONE } from "@/lib/twilio-client"

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase, userId } = session

  const twilioCheck = assertTwilioConfig()
  if (!twilioCheck.ok) return Response.json({ error: twilioCheck.error }, { status: 503 })

  const body = await req.json() as {
    lead_id: string
    phone_id: string
    to_phone: string
  }

  const { lead_id, phone_id, to_phone } = body
  if (!lead_id || !phone_id || !to_phone) {
    return Response.json({ error: "lead_id, phone_id, and to_phone are required" }, { status: 400 })
  }

  // Look up the VA's caller_phone from team_members
  const service = createServiceClient()
  const { data: member } = await service
    .from("team_members")
    .select("caller_phone")
    .eq("user_id", userId)
    .single()

  const caller_phone = (member as any)?.caller_phone as string | null
  if (!caller_phone) {
    return Response.json(
      { error: "No caller phone is configured for your CRM user. Go to Settings → Team → edit your user → set Caller Phone." },
      { status: 400 }
    )
  }

  // Create a call log row first so we have an ID for the TwiML callback
  const { data: callLog, error: logErr } = await supabase
    .from("propstream_call_logs")
    .insert({
      lead_id,
      phone_id,
      caller_user_id: userId,
      to_phone,
      from_phone: TWILIO_FROM_PHONE,
      status: "initiated",
    })
    .select("id")
    .single()

  if (logErr || !callLog) {
    return Response.json({ error: logErr?.message ?? "Failed to create call log" }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
  const twimlUrl = `${appUrl}/api/propstream/twiml/dial?to=${encodeURIComponent(to_phone)}&call_log_id=${callLog.id}`
  const statusCallback = `${appUrl}/api/propstream/twiml/status?call_log_id=${callLog.id}`

  try {
    const twilio = getTwilioClient()
    const call = await twilio.calls.create({
      to: caller_phone,
      from: TWILIO_FROM_PHONE,
      url: twimlUrl,
      statusCallback,
      statusCallbackMethod: "POST",
    })

    await supabase
      .from("propstream_call_logs")
      .update({ twilio_call_sid: call.sid })
      .eq("id", callLog.id)

    // Mark when this phone was last contacted on the lead
    await supabase
      .from("propstream_leads")
      .update({ last_called_at: new Date().toISOString(), last_contacted_phone: to_phone })
      .eq("id", lead_id)

    return Response.json({ call_log_id: callLog.id, twilio_call_sid: call.sid })
  } catch (err: unknown) {
    // Clean up the pending log row if Twilio failed
    await supabase.from("propstream_call_logs").delete().eq("id", callLog.id)
    const message = err instanceof Error ? err.message : "Twilio call failed"
    return Response.json({ error: message }, { status: 502 })
  }
}
