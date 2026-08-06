import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { CompanySettingsForm } from "@/components/settings/company-settings-form"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

export default async function CompanySettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: member } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!member || !can(member.role as TeamRole, "settings:company")) {
    redirect("/settings")
  }

  const { data: settings } = await supabase
    .from("company_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <div>
      <Topbar title="Company Settings" subtitle="Your business info and document defaults" />
      <div className="p-4 sm:p-6 max-w-2xl">
        <CompanySettingsForm userId={user.id} settingsId={settings?.id ?? null} settings={settings ?? null} />
      </div>
    </div>
  )
}
