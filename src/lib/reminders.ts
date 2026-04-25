function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0]
}

// Create an estimate follow-up reminder 2 days from now.
// Idempotent: skips if an uncompleted estimate_follow_up already exists for this estimate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertEstimateFollowUp(supabase: any, params: {
  userId: string
  estimateId: string
  customerId: string
  customerName: string
}): Promise<void> {
  const { userId, estimateId, customerId, customerName } = params

  const { data: existing } = await supabase
    .from("reminders")
    .select("id")
    .eq("user_id", userId)
    .eq("estimate_id", estimateId)
    .eq("type", "estimate_follow_up")
    .is("completed_at", null)
    .maybeSingle()

  if (existing) return

  const dueDate = addDays(todayStr(), 2)
  await supabase.from("reminders").insert({
    user_id:     userId,
    estimate_id: estimateId,
    customer_id: customerId,
    type:        "estimate_follow_up",
    title:       `Follow up on estimate: ${customerName}`,
    due_date:    dueDate,
  })
}

// Replace job reminders whenever a job's schedule changes.
// Deletes any existing job_reminder rows for this job, then creates fresh ones.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function upsertJobReminders(supabase: any, params: {
  userId: string
  jobId: string
  customerId: string
  customerName: string
  scheduledDate: string | null
  scheduledTime?: string | null
}): Promise<void> {
  const { userId, jobId, customerId, customerName, scheduledDate, scheduledTime } = params

  // Always clear stale job reminders first
  await supabase
    .from("reminders")
    .delete()
    .eq("user_id", userId)
    .eq("job_id", jobId)
    .eq("type", "job_reminder")
    .is("completed_at", null)

  if (!scheduledDate) return

  const dayBefore = addDays(scheduledDate, -1)

  const reminders = [
    {
      user_id:     userId,
      job_id:      jobId,
      customer_id: customerId,
      type:        "job_reminder",
      title:       `Job tomorrow: ${customerName}`,
      due_date:    dayBefore,
    },
    {
      user_id:     userId,
      job_id:      jobId,
      customer_id: customerId,
      type:        "job_reminder",
      title:       scheduledTime ? `Job starting now: ${customerName}` : `Job today: ${customerName}`,
      due_date:    scheduledDate,
      ...(scheduledTime ? { due_time: scheduledTime } : {}),
    },
  ]

  await supabase.from("reminders").insert(reminders)
}
