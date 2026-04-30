import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/shared/dashboard-shell"
import { isLegacyRole } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const [{ data: cs }, { data: member }] = await Promise.all([
    supabase
      .from("company_settings")
      .select("logo_url, company_name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("team_members")
      .select("id, role, status, name, project_manager_id")
      .eq("user_id", user.id)
      .single(),
  ])

  // Block access if not an active team member or if role is legacy
  if (!member || member.status !== "active" || isLegacyRole(member.role)) {
    redirect("/access-denied")
  }

  return (
    <DashboardShell
      logoUrl={cs?.logo_url ?? null}
      companyName={cs?.company_name ?? null}
      userRole={member.role as TeamRole}
      userName={member.name}
      pmId={(member as any).project_manager_id ?? null}
    >
      {children}
    </DashboardShell>
  )
}
