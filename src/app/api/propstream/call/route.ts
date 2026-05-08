import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase, userId } = session

  const body = await req.json() as {
    lead_id: string
    phone_id: string
    to_phone: string
  }

  const { lead_id, phone_id, to_phone } = body
  if (!lead_id || !phone_id || !to_phone) {
    return Response.json({ error: "lead_id, phone_id, and to_phone are required" }, { status: 400 })
  }

  // Create the call log row; the browser SDK connects directly to the lead via TwiML App
  const { data: callLog, error: logErr } = await supabase
    .from("propstream_call_logs")
    .insert({
      lead_id,
      phone_id,
      caller_user_id: userId,
      to_phone,
      status: "initiated",
    })
    .select("id")
    .single()

  if (logErr || !callLog) {
    return Response.json({ error: logErr?.message ?? "Failed to create call log" }, { status: 500 })
  }

  // Mark when this phone was last contacted on the lead
  await supabase
    .from("propstream_leads")
    .update({ last_called_at: new Date().toISOString(), last_contacted_phone: to_phone })
    .eq("id", lead_id)

  return Response.json({ call_log_id: callLog.id })
}
