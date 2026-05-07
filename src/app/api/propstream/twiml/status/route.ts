import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

// Public — Twilio posts call status updates here.
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const call_log_id = searchParams.get("call_log_id")
  if (!call_log_id) return new Response("", { status: 204 })

  const formData = await req.formData()
  const callStatus   = (formData.get("CallStatus") as string | null) ?? ""
  const callDuration = (formData.get("CallDuration") as string | null) ?? ""

  const duration = parseInt(callDuration, 10)

  const supabase = createServiceClient()
  await supabase
    .from("propstream_call_logs")
    .update({
      status: callStatus,
      ended_at: new Date().toISOString(),
      ...(isNaN(duration) ? {} : { duration_seconds: duration }),
    })
    .eq("id", call_log_id)
    .in("status", ["initiated", "ringing", "in-progress"])  // don't overwrite if already completed

  return new Response("", { status: 204 })
}
