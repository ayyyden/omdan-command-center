import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { parkLead } from "@/lib/park-lead"

interface RouteCtx { params: Promise<{ id: string }> }

// POST /api/meta-leads/[id]/park { list: "on_hold" | "follow_up", note?, follow_up_at? }
// Moves a lead to On Hold / Follow-up from the Leads page. What that does
// (calendar, booking sheet, no texts) is in park-lead.ts.
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => ({})) as { list?: string; note?: string | null; follow_up_at?: string | null }
  const list = body.list === "on_hold" || body.list === "follow_up" ? body.list : null
  if (!list) return Response.json({ error: "list must be on_hold or follow_up" }, { status: 400 })
  const followUpAt = body.follow_up_at ? new Date(body.follow_up_at) : null
  if (followUpAt && Number.isNaN(followUpAt.getTime())) return Response.json({ error: "Invalid follow-up date" }, { status: 400 })

  const r = await parkLead(createServiceClient(), id, list, { note: body.note, followUpAt })
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status })
  return Response.json({ lead: r.lead })
}
