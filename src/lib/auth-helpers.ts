import { createClient } from "@/lib/supabase/server"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

export interface SessionMember {
  userId: string
  role: TeamRole
  /** project_managers.id — set for project_manager/field_worker to scope their job view */
  pmId: string | null
  /** The supabase server client — reuse to avoid creating a second instance */
  supabase: Awaited<ReturnType<typeof createClient>>
}

/**
 * Resolves the authenticated user + their team_member record in one round-trip.
 * Returns null if unauthenticated or not an active member.
 */
export async function getSessionMember(): Promise<SessionMember | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: member } = await supabase
    .from("team_members")
    .select("role, status, project_manager_id")
    .eq("user_id", user.id)
    .single()

  if (!member || member.status !== "active") return null

  return {
    userId: user.id,
    role: member.role as TeamRole,
    pmId: (member.project_manager_id ?? null) as string | null,
    supabase,
  }
}

/**
 * Convenience wrapper for API route handlers.
 * Returns the session member or a ready-to-return Response if auth/permission fails.
 */
export async function requirePermission(
  action: string,
): Promise<SessionMember | Response> {
  const member = await getSessionMember()
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 })
  if (!can(member.role, action)) return Response.json({ error: "Forbidden" }, { status: 403 })
  return member
}

/** Roles that see only jobs assigned to their linked project_manager_id */
export function hasJobScope(role: TeamRole): boolean {
  return role === "project_manager" || role === "field_worker" || role === "viewer"
}

/** Sentinel UUID — causes a query to return zero rows */
export const NO_ROWS_ID = "00000000-0000-0000-0000-000000000000"
