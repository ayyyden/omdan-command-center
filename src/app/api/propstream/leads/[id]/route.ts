import { requirePermission } from "@/lib/auth-helpers"

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("propstream:view")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data: lead, error } = await supabase
    .from("propstream_leads")
    .select(`
      *,
      propstream_lead_phones(
        id, phone, phone_type, is_active, is_wrong_number, position,
        is_completed, attempt_count, last_outcome, last_called_at
      ),
      propstream_call_logs(id, to_phone, outcome, duration_seconds, notes, started_at, ended_at, status),
      propstream_sms_logs(id, direction, to_phone, from_phone, body, is_auto, created_at)
    `)
    .eq("id", id)
    .order("started_at", { referencedTable: "propstream_call_logs", ascending: false })
    .order("created_at", { referencedTable: "propstream_sms_logs", ascending: false })
    .single()

  if (error) return Response.json({ error: error.message }, { status: error.code === "PGRST116" ? 404 : 500 })

  return Response.json(lead)
}
