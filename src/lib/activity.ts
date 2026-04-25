type ActivityParams = {
  userId: string
  entityType: "customer" | "estimate" | "job" | "expense" | "payment" | "reminder"
  entityId: string
  action: string
  description: string
  jobId?: string
}

// Works with both the server and client Supabase instances
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function logActivity(supabase: any, params: ActivityParams): Promise<void> {
  await supabase.from("activity_log").insert({
    user_id: params.userId,
    entity_type: params.entityType,
    entity_id: params.entityId,
    action: params.action,
    description: params.description,
    ...(params.jobId ? { job_id: params.jobId } : {}),
  })
}

// Customer status advancement order — Closed Lost is terminal and excluded
const CUSTOMER_STATUS_ORDER = [
  "New Lead",
  "Contacted",
  "Estimate Sent",
  "Follow-Up Needed",
  "Approved",
  "Scheduled",
  "In Progress",
  "Completed",
  "Paid",
] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function advanceCustomerStatus(supabase: any, customerId: string, targetStatus: string): Promise<void> {
  const { data } = await supabase.from("customers").select("status").eq("id", customerId).single()
  if (!data) return
  const current = data.status as string
  if (current === "Closed Lost") return
  const currentIdx = CUSTOMER_STATUS_ORDER.indexOf(current as never)
  const targetIdx = CUSTOMER_STATUS_ORDER.indexOf(targetStatus as never)
  if (currentIdx === -1 || targetIdx <= currentIdx) return
  await supabase.from("customers").update({ status: targetStatus }).eq("id", customerId)
}
