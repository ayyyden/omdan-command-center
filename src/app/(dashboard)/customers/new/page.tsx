import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { CustomerForm } from "@/components/customers/customer-form"

export default async function NewCustomerPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  return (
    <div>
      <Topbar title="Add New Lead" subtitle="Create a new lead or customer record" />
      <div className="p-4 sm:p-6 max-w-2xl">
        <CustomerForm userId={user.id} />
      </div>
    </div>
  )
}
