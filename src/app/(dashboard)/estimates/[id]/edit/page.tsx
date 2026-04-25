import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { EstimateForm } from "@/components/estimates/estimate-form"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditEstimatePage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: estimate }, { data: customers }, { data: companySettings }, { data: templates }] = await Promise.all([
    supabase.from("estimates").select("*").eq("id", id).eq("user_id", user.id).single(),
    supabase.from("customers").select("id, name, email").eq("user_id", user.id).order("name"),
    supabase.from("company_settings")
      .select("company_name, phone, email, license_number, logo_url, address, google_review_link, default_estimate_notes")
      .eq("user_id", user.id)
      .single(),
    supabase.from("message_templates")
      .select("id, name, type, subject, body")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .eq("type", "estimate_follow_up")
      .order("name"),
  ])

  if (!estimate) notFound()

  return (
    <div>
      <Topbar title="Edit Estimate" subtitle={estimate.title} />
      <div className="p-4 sm:p-6">
        <EstimateForm
          estimate={estimate as any}
          customers={(customers ?? []) as any}
          userId={user.id}
          templates={templates ?? []}
          companySettings={companySettings ?? null}
        />
      </div>
    </div>
  )
}
