import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { loadAdData } from "@/lib/meta-ads-data"
import { snapshotMetrics } from "@/lib/meta-ads-sync"

interface Ctx { params: Promise<{ id: string }> }

// PATCH /api/meta-ads/actions/[id]  { status: "done" | "dismissed" | "open" }
// Done records the entity's key metrics now; the sync records them again
// 7 days later, so the page (and future reviews) can see what it changed.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { status?: string }
  if (!["done", "dismissed", "open"].includes(body.status ?? "")) {
    return Response.json({ error: "status must be done, dismissed or open" }, { status: 400 })
  }
  const service = createServiceClient()
  const { data: action } = await service.from("meta_ad_actions").select("id, entity_id").eq("id", id).single()
  if (!action) return Response.json({ error: "Action not found" }, { status: 404 })

  const patch: Record<string, unknown> = { status: body.status }
  if (body.status === "done") {
    const snap = action.entity_id ? snapshotMetrics(await loadAdData(service), action.entity_id) : null
    Object.assign(patch, {
      done_at: new Date().toISOString(),
      metrics_at_done: snap,
      metrics_after_7d: null,
      snapshot_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    })
  } else {
    Object.assign(patch, { done_at: null, metrics_at_done: null, metrics_after_7d: null, snapshot_due_at: null })
  }
  const { error } = await service.from("meta_ad_actions").update(patch).eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
