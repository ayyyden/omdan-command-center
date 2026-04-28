import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { canManageRole } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

interface RouteCtx { params: Promise<{ id: string }> }

async function resolveContext(req: Request, id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { err: "Unauthorized", status: 401 as const }

  const { data: invoker } = await supabase
    .from("team_members").select("id, role, status").eq("user_id", user.id).single()

  if (!invoker || invoker.status !== "active" || !["owner", "admin"].includes(invoker.role)) {
    return { err: "Insufficient permissions", status: 403 as const }
  }

  const service = createServiceClient()
  const { data: target } = await service
    .from("team_members").select("id, role, status, user_id").eq("id", id).single()

  if (!target) return { err: "Member not found", status: 404 as const }

  return { invoker, target, service, userId: user.id }
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const { id } = await params
  const ctx = await resolveContext(req, id)
  if ("err" in ctx) return NextResponse.json({ error: ctx.err }, { status: ctx.status })

  const { invoker, target, service, userId } = ctx
  const body = await req.json()
  const { role, status, project_manager_id } = body as { role?: TeamRole; status?: string; project_manager_id?: string | null }

  if (!canManageRole(invoker.role as TeamRole, target.role as TeamRole)) {
    return NextResponse.json({ error: "Cannot manage a member with a higher or equal role" }, { status: 403 })
  }
  if (role && !canManageRole(invoker.role as TeamRole, role)) {
    return NextResponse.json({ error: "Cannot assign a role higher than your own" }, { status: 403 })
  }
  if (status === "disabled" && target.user_id === userId) {
    return NextResponse.json({ error: "Cannot disable yourself" }, { status: 400 })
  }

  // Protect last owner when demoting
  if (role && target.role === "owner" && role !== "owner") {
    const { count } = await service
      .from("team_members").select("id", { count: "exact", head: true })
      .eq("role", "owner").eq("status", "active")
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "At least one Owner must remain" }, { status: 400 })
    }
  }

  const updates: Record<string, unknown> = {}
  if (role) updates.role = role
  if (status) updates.status = status
  if ("project_manager_id" in body) updates.project_manager_id = project_manager_id ?? null

  const { error } = await service.from("team_members").update(updates).eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const { id } = await params
  const ctx = await resolveContext(_req, id)
  if ("err" in ctx) return NextResponse.json({ error: ctx.err }, { status: ctx.status })

  const { invoker, target, service, userId } = ctx

  if (!canManageRole(invoker.role as TeamRole, target.role as TeamRole)) {
    return NextResponse.json({ error: "Cannot remove a member with a higher or equal role" }, { status: 403 })
  }
  if (target.user_id === userId) {
    return NextResponse.json({ error: "Cannot remove your own account" }, { status: 400 })
  }

  // Protect last owner
  if (target.role === "owner" && target.status === "active") {
    const { count } = await service
      .from("team_members").select("id", { count: "exact", head: true })
      .eq("role", "owner").eq("status", "active")
    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Cannot remove the last Owner" }, { status: 400 })
    }
  }

  const { error } = await service.from("team_members").delete().eq("id", id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
