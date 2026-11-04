import { NextRequest } from "next/server"
import { requirePermission, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { sendEstimateEmail } from "@/lib/estimate-delivery"
import { notifyLia } from "@/lib/lia-notifications"

// POST /api/estimates/[id]/send { to, subject?, body? }
// Emails the estimate the one standard way (estimate-delivery.ts): branded
// email + "Review & Sign" link + the PDF attached, valid for 15 days.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { to, subject, body } = (await req.json().catch(() => ({}))) as { to?: string; subject?: string; body?: string }
  if (!to?.trim()) return Response.json({ error: "The customer needs an email address first" }, { status: 400 })

  const session = await requirePermission("estimates:send")
  if (session instanceof Response) return session
  const { userId, role, pmId, supabase } = session

  const { data: estimate } = await supabase.from("estimates").select("id, user_id, title, total, customer:customers(name)").eq("id", id).single()
  if (!estimate) return Response.json({ error: "Not found" }, { status: 404 })

  // PM scope enforcement
  if (hasJobScope(role)) {
    const { data: ownerJob } = await supabase.from("jobs").select("id").eq("estimate_id", id).eq("project_manager_id", pmId ?? NO_ROWS_ID).maybeSingle()
    if (!ownerJob && estimate.user_id !== userId) return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const result = await sendEstimateEmail({ estimateId: id, to: to.trim(), subject, body, userId, appUrl: req.nextUrl.origin })
    return Response.json({ success: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[estimates/send] failed:", err)
    await notifyLia({
      event_type: "estimate_send_failed",
      customer_name: (estimate.customer as unknown as { name: string } | null)?.name,
      document_name: estimate.title ?? undefined, extra: message,
    })
    return Response.json({ error: message }, { status: 500 })
  }
}
