import { redirect } from "next/navigation"
import { getSessionMember, NO_ROWS_ID } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { Topbar } from "@/components/shared/topbar"
import { EstimateForm } from "@/components/estimates/estimate-form"

interface PageProps {
  searchParams: Promise<{ customer?: string }>
}

export default async function NewEstimatePage({ searchParams }: PageProps) {
  const { customer: preselectedCustomerId } = await searchParams

  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "estimates:create")) redirect("/access-denied")
  const { userId, role, pmId, supabase } = session

  const isScopedPM = role === "project_manager"

  // For PM: scope customers to those linked to their assigned jobs
  let customersQuery = supabase.from("customers").select("id, name, email").order("name")
  if (isScopedPM) {
    const { data: pmJobs } = await supabase
      .from("jobs")
      .select("customer_id")
      .eq("project_manager_id", pmId ?? NO_ROWS_ID)
    const pmCustomerIds = [...new Set((pmJobs ?? []).map((j: any) => j.customer_id).filter(Boolean))] as string[]
    customersQuery = pmCustomerIds.length > 0
      ? customersQuery.in("id", pmCustomerIds)
      : customersQuery.eq("id", NO_ROWS_ID)
  }

  const [{ data: customers }, { data: companySettings }, { data: templates }] = await Promise.all([
    customersQuery,
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
          userId={userId}
          preselectedCustomerId={preselectedCustomerId}
          defaultNotes={companySettings?.default_estimate_notes ?? undefined}
          templates={templates ?? []}
          companySettings={companySettings ?? null}
        />
      </div>
    </div>
  )
}
