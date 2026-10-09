import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"

const NUMERIC = [
  "target_cpl", "target_cost_per_appointment", "avg_job_value", "appointment_maturity_days", "sale_maturity_days",
  "min_call_attempts", "quiet_start_hour", "quiet_end_hour", "spend_no_lead_multiple", "cpl_spike_multiple",
  "frequency_limit", "ctr_drop_pct",
] as const

// PATCH /api/meta-ads/settings — targets + alert thresholds (numbers only).
export async function PATCH(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const patch: Record<string, number | string> = { updated_at: new Date().toISOString() }
  for (const k of NUMERIC) {
    if (body[k] === undefined || body[k] === "") continue
    const n = Number(body[k])
    if (!Number.isFinite(n) || n < 0) return Response.json({ error: `${k} must be a positive number` }, { status: 400 })
    if ((k === "quiet_start_hour" || k === "quiet_end_hour") && (n > 23 || !Number.isInteger(n))) {
      return Response.json({ error: `${k} must be a whole hour from 0 to 23` }, { status: 400 })
    }
    patch[k] = n
  }
  const { error } = await createServiceClient().from("meta_ad_settings").upsert({ id: 1, ...patch })
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
