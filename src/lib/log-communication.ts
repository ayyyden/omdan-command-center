import { createClient } from "@/lib/supabase/client"

export interface LogCommunicationParams {
  customerId?: string
  jobId?: string
  estimateId?: string
  templateId?: string
  type: string
  subject?: string | null
  body: string
  channel?: string
}

export async function logCommunication(params: LogCommunicationParams): Promise<void> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from("communication_logs").insert({
    user_id:     user.id,
    customer_id: params.customerId  ?? null,
    job_id:      params.jobId       ?? null,
    estimate_id: params.estimateId  ?? null,
    template_id: params.templateId  ?? null,
    type:        params.type,
    subject:     params.subject     ?? null,
    body:        params.body,
    channel:     params.channel     ?? "manual_copy",
  })
}
