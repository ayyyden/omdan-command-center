import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"

interface RouteCtx { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: member } = await supabase
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .single()

  if (!member || member.status !== "active" || !["owner", "admin"].includes(member.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const body = await req.json()
  const { is_active } = body as { is_active: boolean }

  const service = createServiceClient()

  const { error } = await service
    .from("project_managers")
    .update({ is_active })
    .eq("id", id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // When deactivating: null out open jobs so they don't silently vanish from the scheduler
  let affectedJobs = 0
  if (is_active === false) {
    const OPEN_STATUSES = ["scheduled", "in_progress", "on_hold"]
    const { data: updated } = await service
      .from("jobs")
      .update({ project_manager_id: null })
      .eq("project_manager_id", id)
      .in("status", OPEN_STATUSES)
      .select("id")
    affectedJobs = updated?.length ?? 0
  }

  return NextResponse.json({ ok: true, affectedJobs })
}
