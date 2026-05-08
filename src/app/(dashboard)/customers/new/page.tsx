import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { CustomerForm } from "@/components/customers/customer-form"

interface PageProps {
  searchParams: Promise<{
    from_propstream?: string
    phone_id?:        string
    phone?:           string
    name?:            string
    email?:           string
    address?:         string
    notes?:           string
    return_to?:       string
  }>
}

function e164ToDisplay(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

export default async function NewCustomerPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const params = await searchParams

  const prefill = params.from_propstream
    ? {
        name:        params.name,
        phone:       params.phone ? e164ToDisplay(params.phone) : undefined,
        email:       params.email,
        address:     params.address,
        notes:       params.notes,
        lead_source: "propstream",
      }
    : undefined

  return (
    <div>
      <Topbar
        title="Add New Lead"
        subtitle={prefill ? "Pre-filled from PropStream — review and save" : "Create a new lead or customer record"}
      />
      <div className="p-4 sm:p-6 max-w-2xl">
        <CustomerForm
          userId={user.id}
          prefill={prefill}
          propstreamLeadId={params.from_propstream}
          propstreamPhoneId={params.phone_id}
          returnTo={params.return_to}
        />
      </div>
    </div>
  )
}
