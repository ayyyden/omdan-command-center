import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

// Priority order for work queue: new leads first, then no-answer, then callback
const STATUS_PRIORITY: Record<string, number> = {
  new:              0,
  called_no_answer: 1,
  callback_later:   2,
}

const WORKABLE_STATUSES = Object.keys(STATUS_PRIORITY)

export async function GET(req: NextRequest) {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const { searchParams } = new URL(req.url)
  const list_id = searchParams.get("list_id")

  // Fetch all workable leads with their phones so we can filter to those
  // with at least one uncompleted callable phone. Limit to 1000 — adequate
  // for any practical work session.
  let query = supabase
    .from("propstream_leads")
    .select(`
      id, owner_name, status, list_id, created_at,
      propstream_lead_phones(id, is_active, is_wrong_number, is_completed)
    `)
    .in("status", WORKABLE_STATUSES)
    .order("created_at", { ascending: true })
    .limit(1000)

  if (list_id) query = query.eq("list_id", list_id)

  const { data, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Filter to leads that have at least one phone still needing work
  const workable = (data ?? []).filter((lead) =>
    (lead.propstream_lead_phones as Array<{
      is_active: boolean; is_wrong_number: boolean; is_completed: boolean
    }>).some((p) => p.is_active && !p.is_wrong_number && !p.is_completed)
  )

  // Sort by status priority, then created_at (already ordered by created_at from DB)
  workable.sort((a, b) =>
    (STATUS_PRIORITY[a.status] ?? 9) - (STATUS_PRIORITY[b.status] ?? 9)
  )

  return Response.json({
    queue: workable.map((l) => ({ id: l.id, owner_name: l.owner_name, status: l.status })),
    total: workable.length,
  })
}
