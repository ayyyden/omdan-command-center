import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { CustomerForm } from "@/components/customers/customer-form"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditCustomerPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: customer } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!customer) notFound()

  return (
    <div>
      <Topbar title="Edit Customer" subtitle={customer.name} />
      <div className="p-6 max-w-2xl">
        <CustomerForm customer={customer as any} userId={user.id} />
      </div>
    </div>
  )
}
