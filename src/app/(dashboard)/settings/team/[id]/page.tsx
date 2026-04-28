import { redirect, notFound } from "next/navigation"
import { getSessionMember } from "@/lib/auth-helpers"
import { can, ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import Link from "next/link"
import {
  Briefcase, CheckCircle2, TrendingUp, TrendingDown,
  Minus, FileText, ReceiptText, AlertCircle,
} from "lucide-react"
import { LinkPmBanner } from "@/components/team/link-pm-banner"

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function monthRange(y: number, mo: number) {
  return {
    start: toDateStr(new Date(y, mo, 1)),
    end:   toDateStr(new Date(y, mo + 1, 0)),
  }
}

function pctChange(current: number, prev: number): number | null {
  if (prev === 0) return current === 0 ? 0 : null
  return Math.round(((current - prev) / prev) * 100)
}

function inDateRange(date: string | null, start: string, end: string): boolean {
  if (!date) return false
  const d = date.slice(0, 10)
  return d >= start && d <= end
}

// ─── Page ────────────────────────────────────────────────────────────────────

const NO_ROWS = "00000000-0000-0000-0000-000000000000"

export default async function MemberPerformancePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const session = await getSessionMember()
  if (!session) redirect("/login")
  const { role, supabase } = session

  if (!can(role, "team:view_performance")) redirect("/access-denied")

  const { data: member } = await supabase
    .from("team_members")
    .select("id, user_id, email, name, role, status, project_manager_id")
    .eq("id", id)
    .single()

  if (!member) notFound()

  const now   = new Date()
  const y     = now.getFullYear()
  const mo    = now.getMonth()
  const thisMonth = monthRange(y, mo)
  const prevMonth = monthRange(y, mo - 1)

  // Last 6 months in chronological order
  const sixMonths = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(y, mo - 5 + i, 1)
    return {
      label: d.toLocaleString("en-US", { month: "short", year: "2-digit" }),
      ...monthRange(d.getFullYear(), d.getMonth()),
    }
  })

  const memberRole = member.role as TeamRole

  // ── Project Manager ────────────────────────────────────────────────────────
  let pmPerf: React.ReactNode = null
  if (memberRole === "project_manager") {
    let pmId = member.project_manager_id as string | null
    let pmFoundByFallback: { id: string; name: string; matchedBy: "user_id" | "email" } | null = null

    // Fallback 1: match by project_managers.user_id = team_members.user_id
    if (!pmId && member.user_id) {
      const { data: pmByUser } = await supabase
        .from("project_managers")
        .select("id, name")
        .eq("user_id", member.user_id)
        .eq("is_active", true)
        .maybeSingle()
      if (pmByUser) {
        pmId = (pmByUser as any).id
        pmFoundByFallback = { id: (pmByUser as any).id, name: (pmByUser as any).name, matchedBy: "user_id" }
      }
    }

    // Fallback 2: match by project_managers.email = team_members.email (case-insensitive)
    if (!pmId && member.email) {
      const { data: pmByEmail } = await supabase
        .from("project_managers")
        .select("id, name")
        .ilike("email", member.email)
        .eq("is_active", true)
        .maybeSingle()
      if (pmByEmail) {
        pmId = (pmByEmail as any).id
        pmFoundByFallback = { id: (pmByEmail as any).id, name: (pmByEmail as any).name, matchedBy: "email" }
      }
    }

    if (!pmId) {
      pmPerf = (
        <Card>
          <CardContent className="pt-5 pb-5 px-4">
            <p className="text-sm font-medium mb-1">No PM profile linked</p>
            <p className="text-xs text-muted-foreground">
              This team member has no Project Manager profile assigned. Go to{" "}
              <strong>Settings → Project Managers</strong> to create a PM profile, then assign it
              via <strong>Settings → Team → Change Role</strong>.
            </p>
          </CardContent>
        </Card>
      )
    } else {
      // Fetch all non-cancelled PM jobs with estimate + customer
      const { data: pmJobs } = await supabase
        .from("jobs")
        .select("id, title, status, scheduled_date, completion_date, created_at, estimate_id, customer:customers(name), estimate:estimates(id, total, status, approved_at)")
        .eq("project_manager_id", pmId)
        .neq("status", "cancelled")
        .order("scheduled_date", { ascending: false })

      const jobs = (pmJobs ?? []) as unknown as {
        id: string
        title: string
        status: string
        scheduled_date: string | null
        completion_date: string | null
        created_at: string
        estimate_id: string | null
        customer: { name: string } | null
        estimate: { id: string; total: number; status: string; approved_at: string | null } | null
      }[]

      const jobIds = jobs.map(j => j.id)

      // Fetch approved change orders for PM jobs
      const { data: coData } = jobIds.length > 0
        ? await supabase
            .from("change_orders")
            .select("id, title, amount, approved_at, job_id")
            .in("job_id", jobIds)
            .eq("status", "approved")
        : { data: [] }
      const cos = (coData ?? []) as {
        id: string
        title: string
        amount: number
        approved_at: string | null
        job_id: string
      }[]

      // Fetch pending estimates for PM jobs
      const estimateIds = jobs.map(j => j.estimate_id).filter(Boolean) as string[]
      const { data: pendingEstData } = estimateIds.length > 0
        ? await supabase
            .from("estimates")
            .select("id, title, total, status, created_at, customer:customers(name)")
            .in("id", estimateIds)
            .in("status", ["draft", "sent"])
            .order("created_at", { ascending: false })
        : { data: [] }
      const pendingEsts = (pendingEstData ?? []) as unknown as {
        id: string; title: string; total: number; status: string
        created_at: string; customer: { name: string } | null
      }[]

      // ── Stat computations ─────────────────────────────────────────────────

      // Open = scheduled | in_progress | on_hold
      const openJobs = jobs.filter(j => ["scheduled", "in_progress", "on_hold"].includes(j.status))

      // Active (scheduled or in_progress) for table
      const activeJobs = jobs.filter(j => ["scheduled", "in_progress"].includes(j.status))

      // Completed this month (by completion_date)
      const completedThisMonth = jobs.filter(
        j => j.status === "completed" && inDateRange(j.completion_date, thisMonth.start, thisMonth.end)
      )
      const completedLastMonth = jobs.filter(
        j => j.status === "completed" && inDateRange(j.completion_date, prevMonth.start, prevMonth.end)
      )
      const recentlyCompleted = jobs
        .filter(j => j.status === "completed")
        .slice(0, 10)

      // Sales = estimate.total for jobs with scheduled_date in month (non-cancelled already filtered)
      //       + approved CO amounts for those jobs (by CO's approved_at date)
      // Date field used: jobs.scheduled_date (or created_at as fallback)
      function salesForRange(start: string, end: string): number {
        const monthJobs = jobs.filter(j =>
          inDateRange(j.scheduled_date ?? j.created_at, start, end)
        )
        const monthJobIds = new Set(monthJobs.map(j => j.id))
        const estTotal = monthJobs.reduce((sum, j) => sum + Number(j.estimate?.total ?? 0), 0)
        const coTotal  = cos
          .filter(co => monthJobIds.has(co.job_id) && inDateRange(co.approved_at, start, end))
          .reduce((sum, co) => sum + Number(co.amount ?? 0), 0)
        return estTotal + coTotal
      }

      const salesThisMonth = salesForRange(thisMonth.start, thisMonth.end)
      const salesLastMonth = salesForRange(prevMonth.start, prevMonth.end)
      const salesDelta     = salesThisMonth - salesLastMonth
      const salesPct       = pctChange(salesThisMonth, salesLastMonth)

      // Approved COs this month
      const approvedCOsThisMonth = cos.filter(co =>
        inDateRange(co.approved_at, thisMonth.start, thisMonth.end)
      )
      const approvedCOsTotal = approvedCOsThisMonth.reduce((sum, co) => sum + Number(co.amount ?? 0), 0)

      // Approved estimates this month (from jobs)
      const approvedEstsThisMonth = jobs.filter(j =>
        j.estimate?.status === "approved" &&
        inDateRange(j.estimate.approved_at, thisMonth.start, thisMonth.end)
      )

      // Average job value over last 6 months (all non-cancelled jobs with scheduled_date)
      const sixMonthJobsWithEst = jobs.filter(j =>
        inDateRange(j.scheduled_date ?? null, sixMonths[0].start, sixMonths[5].end) &&
        j.estimate?.total
      )
      const sixMonthEstTotal = sixMonthJobsWithEst.reduce((sum, j) => sum + Number(j.estimate!.total), 0)
      const avgJobValue = sixMonthJobsWithEst.length > 0
        ? Math.round(sixMonthEstTotal / sixMonthJobsWithEst.length)
        : null

      // 6-month trend
      const trend = sixMonths.map(mo => ({
        label:    mo.label,
        jobCount: jobs.filter(j => inDateRange(j.scheduled_date ?? j.created_at, mo.start, mo.end)).length,
        sales:    salesForRange(mo.start, mo.end),
      }))

      pmPerf = (
        <>
          {/* Auto-link banner — shown when PM was found by fallback (email/user_id) */}
          {pmFoundByFallback && (
            <LinkPmBanner
              memberId={member.id}
              pmId={pmFoundByFallback.id}
              pmName={pmFoundByFallback.name}
              matchedBy={pmFoundByFallback.matchedBy}
            />
          )}

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Open Jobs"
              value={String(openJobs.length)}
              icon={<Briefcase className="w-4 h-4" />}
            />
            <StatCard
              label="Completed (Month)"
              value={String(completedThisMonth.length)}
              sub={`${completedLastMonth.length} last month`}
              icon={<CheckCircle2 className="w-4 h-4" />}
            />
            <StatCard
              label="Sales (Month)"
              value={formatCurrency(salesThisMonth)}
              sub={`${formatCurrency(salesLastMonth)} last month`}
              icon={<TrendingUp className="w-4 h-4" />}
            />
            <StatCard
              label="vs Last Month"
              value={salesDelta >= 0 ? `+${formatCurrency(salesDelta)}` : formatCurrency(salesDelta)}
              sub={salesPct === null ? "N/A (no prev)" : salesPct === 0 ? "No change" : `${salesPct > 0 ? "+" : ""}${salesPct}%`}
              icon={
                salesDelta > 0 ? <TrendingUp className="w-4 h-4 text-green-600" /> :
                salesDelta < 0 ? <TrendingDown className="w-4 h-4 text-destructive" /> :
                <Minus className="w-4 h-4 text-muted-foreground" />
              }
              highlight={salesDelta > 0 ? "positive" : salesDelta < 0 ? "negative" : undefined}
            />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard
              label="Avg Job Value"
              value={avgJobValue !== null ? formatCurrency(avgJobValue) : "—"}
              sub="last 6 months"
            />
            <StatCard
              label="Pending Estimates"
              value={String(pendingEsts.length)}
              sub="draft or sent"
              icon={<FileText className="w-4 h-4" />}
            />
            <StatCard
              label="Est. Approved (Month)"
              value={String(approvedEstsThisMonth.length)}
            />
            <StatCard
              label="CO Sales (Month)"
              value={formatCurrency(approvedCOsTotal)}
              sub={`${approvedCOsThisMonth.length} approved`}
            />
          </div>

          {/* 6-month trend */}
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-semibold">Monthly Sales Trend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Based on <span className="font-medium">jobs.scheduled_date</span> + approved change orders by approved_at
              </p>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-muted-foreground border-b">
                      <th className="text-left py-2 pr-4 font-medium">Month</th>
                      <th className="text-right py-2 pr-4 font-medium">Jobs</th>
                      <th className="text-right py-2 font-medium">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((row, i) => (
                      <tr key={i} className={cn("border-b last:border-0", i === 5 && "font-semibold bg-muted/30")}>
                        <td className="py-2 pr-4 text-xs">{row.label}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{row.jobCount}</td>
                        <td className="py-2 text-right tabular-nums">{formatCurrency(row.sales)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Active jobs */}
          <SectionCard title="Active Jobs" count={activeJobs.length}>
            {activeJobs.length === 0 ? (
              <EmptyRow text="No active jobs" />
            ) : (
              activeJobs.slice(0, 15).map(j => (
                <JobRow key={j.id} job={j} />
              ))
            )}
          </SectionCard>

          {/* Recently completed */}
          <SectionCard title="Recently Completed" count={recentlyCompleted.length}>
            {recentlyCompleted.length === 0 ? (
              <EmptyRow text="No completed jobs" />
            ) : (
              recentlyCompleted.map(j => (
                <JobRow key={j.id} job={j} showCompletion />
              ))
            )}
          </SectionCard>

          {/* Pending estimates */}
          {pendingEsts.length > 0 && (
            <SectionCard title="Pending Estimates" count={pendingEsts.length}>
              {pendingEsts.map(e => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-2">
                  <div className="min-w-0">
                    <Link href={`/estimates/${e.id}`} className="text-sm font-medium hover:underline truncate block">
                      {e.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">{(e.customer as any)?.name ?? "—"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{formatCurrency(Number(e.total))}</p>
                    <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                  </div>
                </div>
              ))}
            </SectionCard>
          )}
        </>
      )
    }
  }

  // ── Office ─────────────────────────────────────────────────────────────────
  let officePerf: React.ReactNode = null
  if (memberRole === "office") {
    const uid = member.user_id as string | null

    if (!uid) {
      officePerf = (
        <Card>
          <CardContent className="pt-5 pb-5">
            <p className="text-sm text-muted-foreground">
              No user account linked — invite pending or member not yet active.
            </p>
          </CardContent>
        </Card>
      )
    } else {
      const [{ data: estCreatedThisMonth }, { data: estSentThisMonth }, { data: estAll }] = await Promise.all([
        supabase
          .from("estimates")
          .select("id")
          .eq("user_id", uid)
          .gte("created_at", thisMonth.start),
        supabase
          .from("estimates")
          .select("id")
          .eq("user_id", uid)
          .not("sent_at", "is", null)
          .gte("sent_at", thisMonth.start),
        supabase
          .from("estimates")
          .select("id, title, total, status, created_at, customer:customers(name)")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(10),
      ])

      const totalCreated = (estCreatedThisMonth ?? []).length
      const totalSent    = (estSentThisMonth ?? []).length
      const recentEsts   = (estAll ?? []) as unknown as {
        id: string; title: string; total: number; status: string
        created_at: string; customer: { name: string } | null
      }[]

      officePerf = (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Estimates Created (Month)" value={String(totalCreated)} icon={<FileText className="w-4 h-4" />} />
            <StatCard label="Estimates Sent (Month)"    value={String(totalSent)} />
            <StatCard label="Recent Estimates"           value={String(recentEsts.length)} sub="last 10 shown" />
          </div>

          <SectionCard title="Recent Estimates" count={recentEsts.length}>
            {recentEsts.length === 0 ? (
              <EmptyRow text="No estimates found" />
            ) : (
              recentEsts.map(e => (
                <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0 gap-2">
                  <div className="min-w-0">
                    <Link href={`/estimates/${e.id}`} className="text-sm font-medium hover:underline truncate block">
                      {e.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {(e.customer as any)?.name ?? "—"} · {formatDate(e.created_at)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">{formatCurrency(Number(e.total))}</p>
                    <Badge variant="outline" className="text-[10px]">{e.status}</Badge>
                  </div>
                </div>
              ))
            )}
          </SectionCard>

          <LimitationNote items={[
            "Contract creation/sending is not attributed per user — contract stats unavailable.",
            "Customer touches and communication logs not yet aggregated per team member.",
          ]} />
        </>
      )
    }
  }

  // ── Field Worker ───────────────────────────────────────────────────────────
  let fwPerf: React.ReactNode = null
  if (memberRole === "field_worker") {
    const pmId = member.project_manager_id as string | null
    const uid  = member.user_id as string | null

    const [{ data: fwJobData }, { data: expData }] = await Promise.all([
      pmId
        ? supabase
            .from("jobs")
            .select("id, title, status, scheduled_date, completion_date, customer:customers(name)")
            .eq("project_manager_id", pmId)
            .neq("status", "cancelled")
            .order("scheduled_date", { ascending: false })
        : Promise.resolve({ data: [] }),
      uid
        ? supabase
            .from("expenses")
            .select("id, amount, category, date, created_at")
            .eq("user_id", uid)
            .gte("created_at", thisMonth.start)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
    ])

    const fwJobs = (fwJobData ?? []) as unknown as {
      id: string; title: string; status: string
      scheduled_date: string | null; completion_date: string | null
      customer: { name: string } | null
    }[]
    const expenses = (expData ?? []) as { id: string; amount: number; category: string }[]

    const activeJobs = fwJobs.filter(j => ["scheduled", "in_progress"].includes(j.status))
    const completedThisMonth = fwJobs.filter(
      j => j.status === "completed" && inDateRange(j.completion_date, thisMonth.start, thisMonth.end)
    )
    const expensesTotal = expenses.reduce((sum, e) => sum + Number(e.amount ?? 0), 0)

    fwPerf = (
      <>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCard label="Active Jobs"            value={String(activeJobs.length)} icon={<Briefcase className="w-4 h-4" />} />
          <StatCard label="Completed (Month)"      value={String(completedThisMonth.length)} icon={<CheckCircle2 className="w-4 h-4" />} />
          <StatCard label="Expenses This Month"    value={String(expenses.length)} sub={expenses.length > 0 ? formatCurrency(expensesTotal) : undefined} icon={<ReceiptText className="w-4 h-4" />} />
        </div>

        {!pmId && (
          <Card>
            <CardContent className="pt-4 pb-4">
              <p className="text-sm text-muted-foreground">No Project Manager linked — job data unavailable.</p>
            </CardContent>
          </Card>
        )}

        {pmId && (
          <SectionCard title="Active Jobs" count={activeJobs.length}>
            {activeJobs.length === 0 ? (
              <EmptyRow text="No active jobs" />
            ) : (
              activeJobs.slice(0, 10).map(j => (
                <JobRow key={j.id} job={j as any} />
              ))
            )}
          </SectionCard>
        )}

        <LimitationNote items={[
          "Individual job assignments per field worker are not tracked — showing all jobs for the linked PM.",
          "Expense stats reflect expenses submitted by this user account this month.",
        ]} />
      </>
    )
  }

  // ── Viewer / Owner / Admin ─────────────────────────────────────────────────
  let genericPerf: React.ReactNode = null
  if (!["project_manager", "office", "field_worker"].includes(memberRole)) {
    genericPerf = (
      <Card>
        <CardContent className="pt-5 pb-5">
          <p className="text-sm text-muted-foreground">
            Performance tracking is not applicable for the <strong>{ROLE_LABELS[memberRole]}</strong> role.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div>
      <Topbar title={member.name} subtitle="Performance Overview" />
      <div className="p-4 sm:p-6 max-w-4xl space-y-6">

        {/* Profile card */}
        <Card>
          <CardContent className="pt-4 pb-4 px-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-lg font-bold text-muted-foreground uppercase shrink-0">
                {member.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h2 className="text-base font-semibold">{member.name}</h2>
                  <Badge className={cn("text-xs", ROLE_COLORS[memberRole])}>
                    {ROLE_LABELS[memberRole]}
                  </Badge>
                  <StatusBadge status={member.status} />
                </div>
                <p className="text-sm text-muted-foreground">{member.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {pmPerf}
        {officePerf}
        {fwPerf}
        {genericPerf}
      </div>
    </div>
  )
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon, highlight,
}: {
  label: string
  value: string
  sub?: string
  icon?: React.ReactNode
  highlight?: "positive" | "negative"
}) {
  return (
    <Card>
      <CardContent className="pt-3 pb-3 px-3 sm:pt-4 sm:pb-4 sm:px-4">
        <div className="flex items-start justify-between gap-1">
          <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
          {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
        </div>
        <p className={cn(
          "text-lg sm:text-xl font-bold mt-1 leading-none tabular-nums",
          highlight === "positive" && "text-green-600",
          highlight === "negative" && "text-destructive",
        )}>
          {value}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function SectionCard({
  title, count, children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          {title}
          <span className="text-xs font-normal text-muted-foreground">({count})</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {children}
      </CardContent>
    </Card>
  )
}

function JobRow({
  job,
  showCompletion = false,
}: {
  job: {
    id: string
    title: string
    status: string
    scheduled_date?: string | null
    completion_date?: string | null
    customer?: { name: string } | null
    estimate?: { total: number } | null
  }
  showCompletion?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0 gap-2">
      <div className="min-w-0">
        <Link href={`/jobs/${job.id}`} className="text-sm font-medium hover:underline truncate block">
          {job.title}
        </Link>
        <p className="text-xs text-muted-foreground">
          {(job.customer as any)?.name ?? "—"}
          {showCompletion && job.completion_date
            ? ` · completed ${formatDate(job.completion_date)}`
            : !showCompletion && job.scheduled_date
              ? ` · ${formatDate(job.scheduled_date)}`
              : ""}
        </p>
      </div>
      <div className="text-right shrink-0">
        {job.estimate?.total != null && (
          <p className="text-xs font-semibold">{formatCurrency(Number(job.estimate.total))}</p>
        )}
        <JobStatusChip status={job.status} />
      </div>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground py-2">{text}</p>
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active")   return <Badge variant="outline" className="text-xs text-green-600 border-green-600/40">Active</Badge>
  if (status === "invited")  return <Badge variant="outline" className="text-xs text-amber-600 border-amber-600/40">Pending</Badge>
  return <Badge variant="outline" className="text-xs text-muted-foreground">Disabled</Badge>
}

function JobStatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    scheduled:   "text-blue-600",
    in_progress: "text-amber-600",
    completed:   "text-green-600",
    on_hold:     "text-muted-foreground",
    cancelled:   "text-destructive",
  }
  return (
    <span className={cn("text-[10px] font-medium capitalize", map[status] ?? "text-muted-foreground")}>
      {status.replace("_", " ")}
    </span>
  )
}

function LimitationNote({ items }: { items: string[] }) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex gap-2">
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Metrics not yet available</p>
            <ul className="space-y-0.5">
              {items.map((item, i) => (
                <li key={i} className="text-xs text-muted-foreground">· {item}</li>
              ))}
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
