import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { loadAdData } from "@/lib/meta-ads-data"
import { snapshotMetrics } from "@/lib/meta-ads-sync"

interface Ctx { params: Promise<{ id: string }> }

// PATCH /api/meta-ads/actions/[id]  { status?: "done" | "dismissed" | "open", text?: string }
// Done records the entity's key metrics now; the sync records them again
// 7 days later, so the page (and future reviews) can see what it changed.
// `text` edits the suggestion's wording.
export async function PATCH(req: Request, { params }: Ctx) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const { id } = await params
  const body = await req.json().catch(() => ({})) as { status?: string; text?: string }

  const patch: Record<string, unknown> = {}
  if (body.text !== undefined) {
    const text = String(body.text).trim()
    if (!text) return Response.json({ error: "The suggestion can't be empty" }, { status: 400 })
    patch.text = text.slice(0, 1000)
  }
  if (body.status !== undefined && !["done", "dismissed", "open"].includes(body.status)) {
    return Response.json({ error: "status must be done, dismissed or open" }, { status: 400 })
  }
  if (!body.status && !patch.text) return Response.json({ error: "Nothing to change" }, { status: 400 })

  const service = createServiceClient()
  const { data: action } = await service.from("meta_ad_actions").select("id, entity_id").eq("id", id).single()
  if (!action) return Response.json({ error: "Action not found" }, { status: 404 })

  if (body.status === "done") {
    const snap = action.entity_id ? snapshotMetrics(await loadAdData(service), action.entity_id) : null
    Object.assign(patch, {
      status: "done",
      done_at: new Date().toISOString(),
      metrics_at_done: snap,
      metrics_after_7d: null,
      snapshot_due_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    })
  } else if (body.status) {
    Object.assign(patch, { status: body.status, done_at: null, metrics_at_done: null, metrics_after_7d: null, snapshot_due_at: null })
  }
  const { error } = await service.from("meta_ad_actions").update(patch).eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

// DELETE /api/meta-ads/actions/[id] — remove a suggestion for good
export async function DELETE(req: Request, { params }: Ctx) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const { id } = await params
  const { error } = await createServiceClient().from("meta_ad_actions").delete().eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
