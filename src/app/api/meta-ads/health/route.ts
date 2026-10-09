import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { checkHealth } from "@/lib/meta-ads"
import { healthHits } from "@/lib/meta-ads-rules"
import { processAlerts } from "@/lib/meta-ads-alerts"
import { loadSettings } from "@/lib/meta-ads-settings"

// GET /api/meta-ads/health — token valid, permissions, account status.
// A broken token / disabled account / failed payment also alerts Lia.
export async function GET(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:view")
  if (auth instanceof Response) return auth
  const service = createServiceClient()
  const health = await checkHealth()
  await service.from("meta_ad_health").insert({ ok: health.ok, account: health.account, problems: health.problems })
  const alerts = await processAlerts(service, healthHits(health.problems), await loadSettings(service))
  return Response.json({ ...health, alerts })
}
