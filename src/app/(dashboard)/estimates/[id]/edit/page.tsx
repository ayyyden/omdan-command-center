import { notFound, redirect } from "next/navigation"
import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { Topbar } from "@/components/shared/topbar"
import { EstimateForm } from "@/components/estimates/estimate-form"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditEstimatePage({ params }: PageProps) {
  const { id } = await params

  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "estimates:edit")) redirect("/access-denied")
  const { userId, role, pmId, supabase } = session

  const [{ data: estimate }, { data: linkedJob }, { data: customers }, { data: companySettings }, { data: templates }] = await Promise.all([
    supabase.from("estimates").select("*").eq("id", id).single(),
    supabase.from("jobs").select("id, project_manager_id").eq("estimate_id", id).maybeSingle(),
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

  if (!estimate) notFound()

  // PM scope enforcement
  if (role === "project_manager") {
    if (linkedJob) {
      if ((linkedJob as any).project_manager_id !== pmId) redirect("/access-denied")
    } else {
      if (estimate.user_id !== userId) redirect("/access-denied")
    }
  }

  return (
    <div>
      <Topbar title="Edit Estimate" subtitle={estimate.title} />
      <div className="p-4 sm:p-6">
        <EstimateForm
          estimate={estimate as any}
          customers={(customers ?? []) as any}
          userId={userId}
          templates={templates ?? []}
          companySettings={companySettings ?? null}
        />
      </div>
    </div>
  )
}
