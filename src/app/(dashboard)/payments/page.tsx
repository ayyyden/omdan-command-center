import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { formatCurrency } from "@/lib/utils"
import { PaymentsBulkTable } from "@/components/payments/payments-bulk-table"

export default async function PaymentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: payments } = await supabase
    .from("payments")
    .select("*, job:jobs(id, title), customer:customers(id, name)")
    .eq("user_id", user.id)
    .order("date", { ascending: false })

  const total = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)

  return (
    <div>
      <Topbar
        title="Payments"
        subtitle={`${payments?.length ?? 0} payments · ${formatCurrency(total)} total received`}
      />

      <div className="p-4 sm:p-6">
        <PaymentsBulkTable payments={(payments ?? []) as any[]} userId={user.id} />
      </div>
    </div>
  )
}
