import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/utils"
import { JobProfitTable } from "@/components/reports/job-profit-table"
import { ReportsFilters } from "@/components/reports/reports-filters"

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; pm?: string; status?: string }>
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { from, to, pm, status } = await searchParams

  // Date-filtered payments/expenses for top stats
  let paymentsQ = supabase.from("payments").select("amount, date").eq("user_id", user.id)
  if (from) paymentsQ = paymentsQ.gte("date", from)
  if (to)   paymentsQ = paymentsQ.lte("date", to)

  let expensesQ = supabase.from("expenses").select("amount, date, category, expense_type").eq("user_id", user.id)
  if (from) expensesQ = expensesQ.gte("date", from)
  if (to)   expensesQ = expensesQ.lte("date", to)

  // Jobs with PM/status filters and all nested financials
  let jobsQ = supabase
    .from("jobs")
    .select("id, title, status, estimate:estimates(total), customer:customers(name, service_type), project_manager:project_managers(id, name, color), expenses:expenses(amount), payments:payments(amount), invoices:invoices(amount)")
    .eq("user_id", user.id)
    .neq("status", "cancelled")
  if (pm && pm !== "all")         jobsQ = jobsQ.eq("project_manager_id", pm)
  if (status && status !== "all") jobsQ = jobsQ.eq("status", status)

  const [
    { data: payments },
    { data: expenses },
    { data: jobs },
    { data: projectManagers },
    { data: sentEstimates },
    { data: approvedEstimates },
  ] = await Promise.all([
    paymentsQ,
    expensesQ,
    jobsQ,
    supabase.from("project_managers").select("*").eq("user_id", user.id).eq("is_active", true).order("name"),
    supabase.from("estimates").select("id").eq("user_id", user.id).in("status", ["sent", "approved", "rejected"]),
    supabase.from("estimates").select("id").eq("user_id", user.id).eq("status", "approved"),
  ])

  // Top stats (date-filtered)
  const totalCollected  = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
  const jobExpenses     = (expenses ?? []).filter((e) => (e as any).expense_type !== "business")
  const bizExpenses     = (expenses ?? []).filter((e) => (e as any).expense_type === "business")
  const totalJobExp     = jobExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const totalOverhead   = bizExpenses.reduce((s, e) => s + Number(e.amount), 0)
  const grossProfit     = totalCollected - totalJobExp
  const netProfit       = grossProfit - totalOverhead

  // Estimate conversion
  const sentCount = sentEstimates?.length ?? 0
  const approvedCount = approvedEstimates?.length ?? 0
  const conversionRate = sentCount > 0 ? Math.round((approvedCount / sentCount) * 100) : 0

  // Job profit rows
  const jobProfitData = (jobs ?? []).map((job: any) => {
    const estTotal      = Number(job.estimate?.total ?? 0)
    const totalPaid     = (job.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    const totalExp      = (job.expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0)
    const invoicedTotal = (job.invoices ?? []).reduce((s: number, i: any) => s + Number(i.amount), 0)
    const profit        = totalPaid - totalExp
    const jobMargin     = totalPaid > 0 ? Math.round((profit / totalPaid) * 100) : 0
    return {
      id:            job.id,
      title:         job.title,
      customer:      job.customer?.name ?? "—",
      serviceType:   job.customer?.service_type as string | null,
      pm:            job.project_manager as { id: string; name: string; color: string } | null,
      status:        job.status as string,
      estimateTotal: estTotal,
      totalPaid,
      totalExpenses: totalExp,
      invoicedTotal,
      grossProfit:   profit,
      margin:        jobMargin,
      unpaid:        Math.max(0, estTotal - totalPaid),
    }
  }).sort((a, b) => b.grossProfit - a.grossProfit)

  const unpaidTotal   = jobProfitData.reduce((s, j) => s + j.unpaid, 0)
  const totalInvoiced = jobProfitData.reduce((s, j) => s + j.invoicedTotal, 0)

  // PM performance
  const pmMap: Record<string, { name: string; color: string; jobs: number; paid: number; expenses: number; profit: number }> = {}
  jobProfitData.forEach((j) => {
    if (!j.pm) return
    if (!pmMap[j.pm.id]) pmMap[j.pm.id] = { name: j.pm.name, color: j.pm.color, jobs: 0, paid: 0, expenses: 0, profit: 0 }
    pmMap[j.pm.id].jobs++
    pmMap[j.pm.id].paid     += j.totalPaid
    pmMap[j.pm.id].expenses += j.totalExpenses
    pmMap[j.pm.id].profit   += j.grossProfit
  })
  const pmRows = Object.values(pmMap).sort((a, b) => b.profit - a.profit)

  // Service type breakdown
  const svcMap: Record<string, { jobs: number; paid: number; expenses: number; profit: number }> = {}
  jobProfitData.forEach((j) => {
    const svc = j.serviceType || "Unspecified"
    if (!svcMap[svc]) svcMap[svc] = { jobs: 0, paid: 0, expenses: 0, profit: 0 }
    svcMap[svc].jobs++
    svcMap[svc].paid     += j.totalPaid
    svcMap[svc].expenses += j.totalExpenses
    svcMap[svc].profit   += j.grossProfit
  })
  const svcRows = Object.entries(svcMap)
    .map(([type, data]) => ({ type, ...data }))
    .sort((a, b) => b.profit - a.profit)
  const hasSvcData = svcRows.length > 1 || (svcRows.length === 1 && svcRows[0].type !== "Unspecified")

  // Expense categories (split by type)
  const jobCatMap: Record<string, number> = {}
  jobExpenses.forEach((e) => { jobCatMap[e.category] = (jobCatMap[e.category] ?? 0) + Number(e.amount) })
  const jobCatRows = Object.entries(jobCatMap).map(([cat, amount]) => ({ cat, amount })).sort((a, b) => b.amount - a.amount)

  const overheadCatMap: Record<string, number> = {}
  bizExpenses.forEach((e) => { overheadCatMap[e.category] = (overheadCatMap[e.category] ?? 0) + Number(e.amount) })
  const overheadCatRows = Object.entries(overheadCatMap).map(([cat, amount]) => ({ cat, amount })).sort((a, b) => b.amount - a.amount)

  const dateLabel = from || to
    ? `${from ?? "…"} → ${to ?? "…"}`
    : "All time"

  return (
    <div>
      <Topbar title="Reports" subtitle={dateLabel} />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Filters */}
        <ReportsFilters
          currentFrom={from ?? ""}
          currentTo={to ?? ""}
          currentPm={pm ?? ""}
          currentStatus={status ?? ""}
          projectManagers={projectManagers ?? []}
        />

        {/* 7 Summary Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
          {[
            { label: "Total Collected", value: formatCurrency(totalCollected) },
            { label: "Job Expenses",    value: formatCurrency(totalJobExp),    cls: "text-destructive" },
            { label: "Gross Profit",    value: formatCurrency(grossProfit),    cls: grossProfit >= 0 ? "text-success" : "text-destructive" },
            { label: "Overhead",        value: formatCurrency(totalOverhead),  cls: "text-destructive" },
            { label: "Net Profit",      value: formatCurrency(netProfit),      cls: netProfit >= 0 ? "text-success" : "text-destructive" },
            { label: "Unpaid Balance",  value: formatCurrency(unpaidTotal),    cls: unpaidTotal > 0 ? "text-warning" : "" },
            { label: "Est. Conversion", value: `${conversionRate}%` },
          ].map(({ label, value, cls }) => (
            <Card key={label}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground leading-tight">{label}</p>
                <p className={`text-xl font-bold mt-1 ${cls ?? ""}`}>{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Job Profit Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Profit by Job</CardTitle>
          </CardHeader>
          <CardContent className="p-0 pb-1">
            <JobProfitTable jobs={jobProfitData} />
          </CardContent>
        </Card>

        {/* PM Performance + Service Type (side-by-side when both present) */}
        {(pmRows.length > 0 || hasSvcData) && (
          <div className={`grid gap-6 ${pmRows.length > 0 && hasSvcData ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
            {pmRows.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">PM Performance</CardTitle>
                </CardHeader>
                <CardContent className="p-0 pb-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">PM</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Jobs</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Collected</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Expenses</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Profit</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pmRows.map((row) => {
                        const m = row.paid > 0 ? Math.round((row.profit / row.paid) * 100) : 0
                        return (
                          <tr key={row.name} className="border-b last:border-0">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />
                                <span className="font-medium">{row.name}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{row.jobs}</td>
                            <td className="px-4 py-2.5 text-right">{formatCurrency(row.paid)}</td>
                            <td className="px-4 py-2.5 text-right text-destructive">{formatCurrency(row.expenses)}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.profit >= 0 ? "text-success" : "text-destructive"}`}>
                              {formatCurrency(row.profit)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
                                m >= 30 ? "bg-success/10 text-success border border-success/30"
                                : m >= 15 ? "bg-warning/10 text-warning border border-warning/30"
                                : "bg-destructive/10 text-destructive border border-destructive/30"
                              }`}>{m}%</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {hasSvcData && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">By Service Type</CardTitle>
                </CardHeader>
                <CardContent className="p-0 pb-1">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Type</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Jobs</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Collected</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Profit</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {svcRows.map((row) => {
                        const m = row.paid > 0 ? Math.round((row.profit / row.paid) * 100) : 0
                        return (
                          <tr key={row.type} className="border-b last:border-0">
                            <td className="px-4 py-2.5 font-medium capitalize">{row.type}</td>
                            <td className="px-4 py-2.5 text-right text-muted-foreground">{row.jobs}</td>
                            <td className="px-4 py-2.5 text-right">{formatCurrency(row.paid)}</td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${row.profit >= 0 ? "text-success" : "text-destructive"}`}>
                              {formatCurrency(row.profit)}
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
                                m >= 30 ? "bg-success/10 text-success border border-success/30"
                                : m >= 15 ? "bg-warning/10 text-warning border border-warning/30"
                                : "bg-destructive/10 text-destructive border border-destructive/30"
                              }`}>{m}%</span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Job Expenses by Category */}
        {jobCatRows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Job Expenses by Category</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">% of Job Expenses</th>
                  </tr>
                </thead>
                <tbody>
                  {jobCatRows.map(({ cat, amount }) => (
                    <tr key={cat} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium capitalize">{cat.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2.5 text-right text-destructive">{formatCurrency(amount)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {totalJobExp > 0 ? `${Math.round((amount / totalJobExp) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Business Overhead by Category */}
        {overheadCatRows.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Business Overhead by Category</CardTitle>
            </CardHeader>
            <CardContent className="p-0 pb-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Category</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">% of Overhead</th>
                  </tr>
                </thead>
                <tbody>
                  {overheadCatRows.map(({ cat, amount }) => (
                    <tr key={cat} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-medium capitalize">{cat.replace(/_/g, " ")}</td>
                      <td className="px-4 py-2.5 text-right text-destructive">{formatCurrency(amount)}</td>
                      <td className="px-4 py-2.5 text-right text-muted-foreground">
                        {totalOverhead > 0 ? `${Math.round((amount / totalOverhead) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
