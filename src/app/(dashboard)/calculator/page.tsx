import { getSessionMember } from "@/lib/auth-helpers"
import { can, roleAtLeast } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { ProfitCalculator } from "@/components/calculator/profit-calculator"
import type { JobOption } from "@/components/calculator/profit-calculator"

const NO_ROWS_ID = "00000000-0000-0000-0000-000000000000"

const OTHER_EXPENSE_CATS = ["subcontractors", "permits", "dump_fees", "equipment", "fuel", "other"]

export default async function CalculatorPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "calculator:view")) redirect("/access-denied")
  const { role, pmId, supabase } = session

  const isAdmin = roleAtLeast(role, "admin")

  let jobsQ = supabase
    .from("jobs")
    .select("id, title, manual_total, estimate:estimates(total), expenses:expenses(amount, category)")
    .neq("status", "cancelled")
    .eq("is_archived", false)
    .order("title")

  if (role === "project_manager") {
    jobsQ = (jobsQ as any).eq("project_manager_id", pmId ?? NO_ROWS_ID)
  }

  const { data: rawJobs } = await jobsQ

  const jobs: JobOption[] = (rawJobs ?? []).map((j: any) => {
    const est = Array.isArray(j.estimate) ? j.estimate[0] : j.estimate
    const estTotal = Number(est?.total ?? 0)
    const totalSell = j.manual_total != null ? Number(j.manual_total) : estTotal

    const result: JobOption = { id: j.id, title: j.title, totalSell }

    if (isAdmin) {
      const exps: { amount: string | number; category: string }[] = j.expenses ?? []
      const sum = (cats: string[]) =>
        exps
          .filter((e) => cats.includes(e.category))
          .reduce((s, e) => s + Number(e.amount), 0)
      result.recordedExpenses = {
        materials: sum(["materials"]),
        labor: sum(["labor"]),
        other: sum(OTHER_EXPENSE_CATS),
      }
    }

    return result
  })

  return (
    <div>
      <Topbar title="Profit Calculator" subtitle="Estimate job profitability" />
      <div className="p-4 sm:p-6">
        <ProfitCalculator jobs={jobs} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
