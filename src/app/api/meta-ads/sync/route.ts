import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { runMetaSync } from "@/lib/meta-ads-sync"

export const maxDuration = 300

// POST /api/meta-ads/sync — health check, Meta structure + insights, Quo call
// history, 7-day action snapshots, rules and alerts. Every 3h from Lia's
// scheduler; also the "Sync now" button on the Ad Advisor page.
export async function POST(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  try {
    const result = await runMetaSync(createServiceClient())
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error("[meta-ads/sync] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
