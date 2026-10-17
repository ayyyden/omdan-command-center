import { authorizeMarketing } from "@/lib/marketing-auth"
import { createServiceClient } from "@/lib/supabase/service"

// POST /api/meta-ads/actions  { op: "delete" | "dismiss", ids?: string[], all_open?: boolean }
// Bulk clean-up of the Ad Advisor's suggestion list: selected rows, or every open one.
export async function POST(req: Request) {
  const auth = await authorizeMarketing(req, "marketing:manage")
  if (auth instanceof Response) return auth
  const body = await req.json().catch(() => ({})) as { op?: string; ids?: unknown; all_open?: boolean }
  if (body.op !== "delete" && body.op !== "dismiss") {
    return Response.json({ error: "op must be delete or dismiss" }, { status: 400 })
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : []
  if (!body.all_open && !ids.length) return Response.json({ error: "Pick at least one suggestion" }, { status: 400 })

  const service = createServiceClient()
  const table = service.from("meta_ad_actions")
  const q = body.op === "delete" ? table.delete() : table.update({ status: "dismissed" })
  const { data, error } = await (body.all_open ? q.eq("status", "open") : q.in("id", ids)).select("id")
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true, count: data?.length ?? 0 })
}
