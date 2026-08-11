import { Topbar } from "@/components/shared/topbar"
import { BankWorkspace } from "@/components/bank/bank-workspace"
import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

export default async function BankPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "bank:view")) redirect("/access-denied")

  return (
    <div>
      <Topbar title="Bank" subtitle="Connected accounts and transactions" />
      <BankWorkspace />
    </div>
  )
}
