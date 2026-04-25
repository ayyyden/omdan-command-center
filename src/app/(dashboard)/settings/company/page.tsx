import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { CompanySettingsForm } from "@/components/settings/company-settings-form"

export default async function CompanySettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: settings } = await supabase
    .from("company_settings")
    .select("*")
    .eq("user_id", user.id)
    .single()

  return (
    <div>
      <Topbar title="Company Settings" subtitle="Your business info and document defaults" />
      <div className="p-6 max-w-2xl">
        <CompanySettingsForm userId={user.id} settings={settings ?? null} />
      </div>
    </div>
  )
}
