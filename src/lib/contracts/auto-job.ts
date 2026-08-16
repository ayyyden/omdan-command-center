// A signature-required contract sent while linked only to a customer/lead
// (no job yet — the common case, since jobs are usually only created after
// a lead is sold) should turn into a real job the moment it's signed, so
// the signed document has somewhere to live. Title follows the same
// address-first convention as every other job-creation site (job-title.ts).

import type { SupabaseClient } from "@supabase/supabase-js"
import { deriveJobTitle } from "@/lib/job-title"

/**
 * Returns the job id a signed contract should be attached to: the one
 * already on the sent_contracts row if present, otherwise the customer's
 * most recent job if one already exists, otherwise a freshly created job.
 */
export async function ensureJobForSigning(
  supabase: SupabaseClient,
  userId: string,
  customerId: string,
  existingJobId: string | null,
): Promise<string> {
  if (existingJobId) return existingJobId

  const { data: existingJob } = await supabase
    .from("jobs")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingJob) return existingJob.id

  const { data: customer } = await supabase
    .from("customers")
    .select("address, name")
    .eq("id", customerId)
    .single()

  const title = deriveJobTitle(customer?.address, customer?.name ?? "New Job")

  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ user_id: userId, customer_id: customerId, title })
    .select("id")
    .single()

  if (error || !job) throw new Error("Could not auto-create job for signed contract")
  return job.id
}
