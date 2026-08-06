import { NextRequest } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

// Called nightly (12am America/Los_Angeles) by the lia-bridge cron job.
// Moves every lead in "second_call_list" back to "call_list" and clears
// last_outcome, emptying the Second Call List.
export async function POST(req: NextRequest) {
  const unauthorized = verifyAssistantSecret(req)
  if (unauthorized) return unauthorized

  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from("meta_leads")
    .update({ list: "call_list", last_outcome: null })
    .eq("list", "second_call_list")
    .select("id")

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ moved: data?.length ?? 0 })
}
