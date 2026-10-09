import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { runAdReview, type Period } from "@/lib/meta-ads-review"

export const maxDuration = 300

// POST /api/meta-ads/review?period=daily|weekly|monthly[&dry_run=1]
export async function POST(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const url = new URL(req.url)
  const p = url.searchParams.get("period")
  const period: Period = p === "weekly" || p === "monthly" ? p : "daily"
  try {
    const result = await runAdReview(createServiceClient(), period, { dryRun: url.searchParams.get("dry_run") === "1" })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error("[meta-ads/review] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
