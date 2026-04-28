import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { redirect } from "next/navigation"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { TeamMemberList } from "@/components/team/team-member-list"
import { roleAtLeast } from "@/lib/permissions"

export default async function TeamSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: currentMember } = await supabase
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .single()

  if (!currentMember || !can(currentMember.role as TeamRole, "team:view")) {
    redirect("/settings")
  }

  const [{ data: members }, { data: projectManagers }] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, user_id, email, name, role, status, created_at, invite_expires_at, project_manager_id, invite_token")
      .order("created_at", { ascending: true }),
    supabase
      .from("project_managers")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
  ])

  const canViewPerformance = roleAtLeast(currentMember.role as TeamRole, "admin")

  return (
    <div>
      <Topbar
        title="Team Members"
        subtitle="Manage access and roles for your workspace"
      />
      <div className="p-4 sm:p-6 max-w-3xl">
        <TeamMemberList
          members={members ?? []}
          currentUserId={user.id}
          currentUserRole={currentMember.role as TeamRole}
          projectManagers={projectManagers ?? []}
          canViewPerformance={canViewPerformance}
        />
      </div>
    </div>
  )
}
