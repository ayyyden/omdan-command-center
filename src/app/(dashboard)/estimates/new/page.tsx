import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { EstimateForm } from "@/components/estimates/estimate-form"

interface PageProps {
  searchParams: Promise<{ customer?: string }>
}

export default async function NewEstimatePage({ searchParams }: PageProps) {
  const { customer: preselectedCustomerId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: customers }, { data: companySettings }, { data: templates }] = await Promise.all([
    supabase.from("customers").select("id, name, email").order("name"),
    supabase.from("company_settings")
      .select("company_name, phone, email, license_number, logo_url, address, google_review_link, default_estimate_notes")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("message_templates")
      .select("id, name, type, subject, body")
      .eq("is_active", true)
      .eq("type", "estimate_follow_up")
      .order("name"),
  ])

  return (
    <div>
      <Topbar title="New Estimate" subtitle="Build a new estimate for a customer" />
      <div className="p-4 sm:p-6">
        <EstimateForm
          customers={(customers ?? []) as any}
          userId={user.id}
          preselectedCustomerId={preselectedCustomerId}
          defaultNotes={companySettings?.default_estimate_notes ?? undefined}
          templates={templates ?? []}
          companySettings={companySettings ?? null}
        />
      </div>
    </div>
  )
}
