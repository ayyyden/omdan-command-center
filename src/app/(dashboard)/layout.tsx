import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { DashboardShell } from "@/components/shared/dashboard-shell"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()

  const [{ data: { user } }, { data: cs }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("company_settings")
      .select("logo_url, company_name")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!user) redirect("/login")

  return (
    <DashboardShell logoUrl={cs?.logo_url ?? null} companyName={cs?.company_name ?? null}>
      {children}
    </DashboardShell>
  )
}
