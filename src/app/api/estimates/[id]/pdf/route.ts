import { NextRequest } from "next/server"
import { requirePermission, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { buildEstimatePdf, storeEstimatePdf, estimateFileName } from "@/lib/estimate-delivery"

// POST /api/estimates/[id]/pdf — builds the estimate PDF (the same one that
// gets emailed), saves it to the estimate's and the lead card's Files, and
// returns its URL.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const session = await requirePermission("estimates:view")
  if (session instanceof Response) return session
  const { userId, role, pmId, supabase } = session

  const { data: estimate } = await supabase.from("estimates").select("id, user_id, customer_id").eq("id", id).single()
  if (!estimate) return Response.json({ error: "Not found" }, { status: 404 })

  // PM scope enforcement
  if (hasJobScope(role)) {
    const { data: ownerJob } = await supabase.from("jobs").select("id").eq("estimate_id", id).eq("project_manager_id", pmId ?? NO_ROWS_ID).maybeSingle()
    if (!ownerJob && estimate.user_id !== userId) return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const { buffer, number } = await buildEstimatePdf(id, { appUrl: req.nextUrl.origin })
    const url = await storeEstimatePdf({ estimateId: id, customerId: estimate.customer_id, userId, buffer, fileName: estimateFileName(number) })
    if (!url) return Response.json({ error: "Couldn't save the PDF" }, { status: 500 })
    return Response.json({ url })
  } catch (err) {
    console.error("[estimates/pdf] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
