import { Topbar } from "@/components/shared/topbar"
import { formatCurrency } from "@/lib/utils"
import { PaymentsBulkTable } from "@/components/payments/payments-bulk-table"
import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

export default async function PaymentsPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "payments:view")) redirect("/access-denied")
  const { userId, supabase } = session

  const { data: payments } = await supabase
    .from("payments")
    .select("*, job:jobs(id, title), customer:customers(id, name)")
    .order("date", { ascending: false })

  const total = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)

  return (
    <div>
      <Topbar
        title="Payments"
        subtitle={`${payments?.length ?? 0} payments · ${formatCurrency(total)} total received`}
      />

      <div className="p-4 sm:p-6">
        <PaymentsBulkTable payments={(payments ?? []) as any[]} userId={userId} />
      </div>
    </div>
  )
}
