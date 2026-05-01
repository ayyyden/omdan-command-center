import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

export async function GET(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const supabase = createServiceClient()
  const { error: dbError } = await supabase.from("jobs").select("id").limit(1)

  return NextResponse.json({
    status: "ok",
    service: "Omdan Command Center",
    crm_connection: dbError ? "error" : "ok",
    approval_system: "ready",
    timestamp: new Date().toISOString(),
  })
}
