import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LeadStatusBadge, JobStatusBadge } from "@/components/shared/status-badge"
import { formatCurrency, formatDate, getTodayLA } from "@/lib/utils"
import {
  Users, FileText, Briefcase, DollarSign,
  TrendingUp, AlertCircle, AlertTriangle, Clock, CalendarDays, Bell,
} from "lucide-react"
import Link from "next/link"
import type { Reminder } from "@/types"
import { ReminderRow } from "@/components/reminders/reminder-row"
import { getSessionMember, NO_ROWS_ID } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

function getActivityLink(entry: {
  entity_type: string
  entity_id: string
  job_id: string | null
}): string | null {
  switch (entry.entity_type) {
    case "customer": return `/customers/${entry.entity_id}`
    case "estimate": return `/estimates/${entry.entity_id}`
    case "job":      return `/jobs/${entry.entity_id}`
    case "expense":
    case "payment":  return entry.job_id ? `/jobs/${entry.job_id}` : null
    default:         return null
  }
}

function getReminderLink(r: { job_id: string | null; estimate_id: string | null }): string | null {
  if (r.job_id)      return `/jobs/${r.job_id}`
  if (r.estimate_id) return `/estimates/${r.estimate_id}`
  return null
}

async function getDashboardData(
  supabase: Awaited<ReturnType<typeof import("@/lib/supabase/server").createClient>>,
  isAdmin: boolean,
  canViewEstimates: boolean,
  pmId: string | null,
  isScopedPM: boolean,
  userId: string,
) {
  const todayLA = getTodayLA()

  const pad = (n: number) => String(n).padStart(2, "0")
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
  const monthStartDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-01`

  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)
  const nextWeekStr = `${nextWeek.getFullYear()}-${pad(nextWeek.getMonth() + 1)}-${pad(nextWeek.getDate())}`

  const threeDaysAgo = new Date(today)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const threeDaysAgoISO = threeDaysAgo.toISOString()

  const empty = Promise.resolve({ data: [] as any[] })
  const pmSentinel = pmId ?? NO_ROWS_ID

  // For PM: pre-fetch accessible estimate IDs (job-linked + self-created)
  let pmEstimateIds: string[] | null = null
  if (isScopedPM && canViewEstimates) {
    const [{ data: pmJobEsts }, { data: ownEsts }] = await Promise.all([
      supabase.from("jobs").select("estimate_id").eq("project_manager_id", pmSentinel).not("estimate_id", "is", null),
      supabase.from("estimates").select("id").eq("user_id", userId),
    ])
    const fromJobs = (pmJobEsts ?? []).map((j: any) => j.estimate_id).filter(Boolean) as string[]
    const fromOwn  = (ownEsts ?? []).map((e: any) => e.id)
    pmEstimateIds = [...new Set([...fromJobs, ...fromOwn])]
  }

  // Build job queries — PM scope applied below via conditional chaining
  const todayJobsQ = supabase
    .from("jobs")
    .select("id, title, status, scheduled_date, scheduled_time, customer:customers(name)")
    .eq("scheduled_date", todayLA)
    .order("scheduled_time", { nullsFirst: false })
  const upcomingJobsQ = supabase
    .from("jobs")
    .select("id, title, status, scheduled_date, scheduled_time, customer:customers(name)")
    .gt("scheduled_date", todayLA)
    .lte("scheduled_date", nextWeekStr)
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_date")
    .limit(7)
  const overdueJobsQ = supabase
    .from("jobs")
    .select("id, title, status, scheduled_date, customer:customers(name)")
    .lt("scheduled_date", todayLA)
    .in("status", ["scheduled", "in_progress"])
    .order("scheduled_date")
    .limit(10)

  const [
    { data: newLeads },
    { data: followUps },
    { data: pendingEstimates },
    { data: overdueEstimates },
    { data: todayJobs },
    { data: upcomingJobs },
    { data: overdueJobs },
    { data: monthPayments },
    { data: monthExpenses },
    { data: unpaidJobs },
    { data: overdueReminders },
    { data: pmSalesJobs },
  ] = await Promise.all([
    // Leads — admin+ only
    isAdmin ? supabase.from("customers").select("id, name, phone, status, service_type, created_at").in("status", ["New Lead", "Contacted"]).order("created_at", { ascending: false }).limit(5) : empty,
    isAdmin ? supabase.from("customers").select("id, name, phone, status, service_type").eq("status", "Follow-Up Needed").limit(10) : empty,
    // Estimates — roles with estimates:view only; PM scoped to their estimate IDs
    (() => {
      if (!canViewEstimates) return empty
      const q = supabase.from("estimates").select("id, title, total, status, created_at, customer:customers(name)").eq("status", "sent").order("created_at", { ascending: false }).limit(5)
      if (!isScopedPM || pmEstimateIds === null) return q
      return pmEstimateIds.length > 0 ? q.in("id", pmEstimateIds) : empty
    })(),
    (() => {
      if (!canViewEstimates) return empty
      const q = supabase.from("estimates").select("id, title, total, updated_at, customer:customers(name)").eq("status", "sent").lt("updated_at", threeDaysAgoISO).order("updated_at").limit(10)
      if (!isScopedPM || pmEstimateIds === null) return q
      return pmEstimateIds.length > 0 ? q.in("id", pmEstimateIds) : empty
    })(),
    // Jobs — scoped to PM's assigned jobs when isScopedPM
    isScopedPM ? todayJobsQ.eq("project_manager_id", pmSentinel) : todayJobsQ,
    isScopedPM ? upcomingJobsQ.eq("project_manager_id", pmSentinel) : upcomingJobsQ,
    isScopedPM ? overdueJobsQ.eq("project_manager_id", pmSentinel) : overdueJobsQ,
    // Financials — admin+ only
    isAdmin ? supabase.from("payments").select("amount").gte("created_at", monthStart) : empty,
    isAdmin ? supabase.from("expenses").select("amount").gte("created_at", monthStart) : empty,
    isAdmin ? supabase.from("jobs").select("id, estimate:estimates(total), payments:payments(amount)").neq("status", "cancelled") : empty,
    supabase.from("reminders").select("id, title, type, due_date, job_id, estimate_id, customer:customers(name)").is("completed_at", null).lt("due_date", todayLA).order("due_date").limit(8),
    // PM sales — estimate + approved CO totals for their jobs scheduled this month
    isScopedPM
      ? supabase
          .from("jobs")
          .select("estimate:estimates(total), change_orders(amount, status)")
          .eq("project_manager_id", pmSentinel)
          .neq("status", "cancelled")
          .gte("scheduled_date", monthStartDate)
      : empty,
  ])

  const monthRevenue  = (monthPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
  const monthExpTotal = (monthExpenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)
  const monthProfit   = monthRevenue - monthExpTotal

  const unpaidTotal = (unpaidJobs ?? []).reduce((sum, job) => {
    const estimateTotal  = Number((job.estimate as any)?.total ?? 0)
    const paymentsTotal  = ((job.payments as any[]) ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    return sum + Math.max(0, estimateTotal - paymentsTotal)
  }, 0)

  const pmSalesThisMonth = (pmSalesJobs ?? []).reduce((sum, job) => {
    const est = Number((job.estimate as any)?.total ?? 0)
    const cos = ((job.change_orders as any[]) ?? [])
      .filter((co: any) => co.status === "approved")
      .reduce((s: number, co: any) => s + Number(co.amount), 0)
    return sum + est + cos
  }, 0)

  return {
    newLeads:          newLeads          ?? [],
    followUps:         followUps         ?? [],
    pendingEstimates:  pendingEstimates  ?? [],
    overdueEstimates:  overdueEstimates  ?? [],
    todayJobs:         todayJobs         ?? [],
    upcomingJobs:      upcomingJobs      ?? [],
    overdueJobs:       overdueJobs       ?? [],
    monthRevenue,
    monthProfit,
    unpaidTotal,
    overdueReminders:  overdueReminders  ?? [],
    pmSalesThisMonth,
  }
}

function formatJobTime(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

export default async function DashboardPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  const { userId, role, supabase, pmId } = session

  const isAdmin = can(role, "dashboard:financials")
  const canViewEstimates = can(role, "estimates:view")
  const isScopedPM = role === "project_manager"
  const data = await getDashboardData(supabase, isAdmin, canViewEstimates, pmId, isScopedPM, userId)

  const financialStats = [
    { label: "Revenue This Month", value: formatCurrency(data.monthRevenue),  icon: DollarSign,  iconClass: "text-success",     bgClass: "bg-success/10" },
    { label: "Profit This Month",  value: formatCurrency(data.monthProfit),   icon: TrendingUp,  iconClass: data.monthProfit >= 0 ? "text-success" : "text-destructive", bgClass: data.monthProfit >= 0 ? "bg-success/10" : "bg-destructive/10" },
    { label: "Unpaid Balances",    value: formatCurrency(data.unpaidTotal),   icon: AlertCircle, iconClass: "text-warning",     bgClass: "bg-warning/10" },
  ]

  return (
    <div>
      <Topbar title="Dashboard" subtitle="Welcome back — here's your business at a glance" />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Stats Row */}
        <div className={`grid grid-cols-1 gap-4 ${isAdmin ? "sm:grid-cols-2 lg:grid-cols-4" : isScopedPM ? "sm:grid-cols-2" : "sm:grid-cols-1 max-w-xs"}`}>
          {isAdmin && financialStats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className={`flex items-center justify-center w-12 h-12 rounded-full ${stat.bgClass} shrink-0`}>
                  <stat.icon className={`w-6 h-6 ${stat.iconClass}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground truncate">{stat.label}</p>
                  <p className="text-xl sm:text-2xl font-bold truncate">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
          {isScopedPM && (
            <Card>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex items-center justify-center w-12 h-12 rounded-full bg-success/10 shrink-0">
                  <DollarSign className="w-6 h-6 text-success" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground">My Sales This Month</p>
                  <p className="text-xl sm:text-2xl font-bold truncate">{formatCurrency(data.pmSalesThisMonth)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Estimate + approved COs</p>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 shrink-0">
                <Briefcase className="w-6 h-6 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">{isScopedPM ? "My Jobs Today" : "Jobs Today"}</p>
                <p className="text-xl sm:text-2xl font-bold">{data.todayJobs.length}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Overdue Jobs */}
        {data.overdueJobs.length > 0 && (
          <Card style={{ borderColor: "color-mix(in oklch, var(--warning) 40%, var(--border))", backgroundColor: "color-mix(in oklch, var(--warning) 5%, var(--card))" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-warning">
                <AlertTriangle className="w-4 h-4" />
                Overdue Jobs ({data.overdueJobs.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.overdueJobs.map((job: any) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-warning/10 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{job.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{(job.customer as any)?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <JobStatusBadge status={job.status} />
                    <Badge variant="warning" className="hidden xs:inline-flex">{formatDate(job.scheduled_date)}</Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Overdue Estimates */}
        {canViewEstimates && data.overdueEstimates.length > 0 && (
          <Card style={{ borderColor: "color-mix(in oklch, var(--warning) 40%, var(--border))", backgroundColor: "color-mix(in oklch, var(--warning) 5%, var(--card))" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-warning">
                <FileText className="w-4 h-4" />
                Overdue Estimates — No Response in 3+ Days ({data.overdueEstimates.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.overdueEstimates.map((est: any) => (
                <Link key={est.id} href={`/estimates/${est.id}`} className="flex items-center justify-between hover:bg-warning/10 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{est.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{(est.customer as any)?.name}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold tabular-nums">{formatCurrency(est.total)}</span>
                    <Badge variant="warning" className="hidden xs:inline-flex">Sent {formatDate(est.updated_at)}</Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Overdue Reminders */}
        {data.overdueReminders.length > 0 && (
          <Card style={{ borderColor: "color-mix(in oklch, var(--warning) 40%, var(--border))", backgroundColor: "color-mix(in oklch, var(--warning) 5%, var(--card))" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-warning">
                <Bell className="w-4 h-4" />
                Overdue Reminders ({data.overdueReminders.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {data.overdueReminders.map((r: any) => (
                <ReminderRow
                  key={r.id}
                  id={r.id}
                  title={r.title}
                  due_date={r.due_date}
                  customerName={r.customer?.name}
                  href={getReminderLink(r)}
                />
              ))}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Jobs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Briefcase className="w-4 h-4 text-primary" />
                  Jobs Today
                </span>
                <Link href="/scheduler" className="text-xs text-primary hover:underline">View calendar</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.todayJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs scheduled today.</p>
              ) : (
                <div className="space-y-3">
                  {data.todayJobs.map((job: any) => (
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{job.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {(job.customer as any)?.name}
                          {job.scheduled_time && <span className="ml-1">· {formatJobTime(job.scheduled_time)}</span>}
                        </p>
                      </div>
                      <div className="shrink-0"><JobStatusBadge status={job.status} /></div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Jobs */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-primary" />
                  Upcoming Jobs (Next 7 Days)
                </span>
                <Link href="/scheduler" className="text-xs text-primary hover:underline">View calendar</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.upcomingJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs scheduled in the next 7 days.</p>
              ) : (
                <div className="space-y-3">
                  {data.upcomingJobs.map((job: any) => (
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{job.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{(job.customer as any)?.name}</p>
                      </div>
                      <div className="shrink-0">
                        <Badge variant="outline">{formatDate(job.scheduled_date)}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* New Leads — admin+ only */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    New Leads Needing Action
                  </span>
                  <Link href="/customers?status=New+Lead" className="text-xs text-primary hover:underline">View all</Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.newLeads.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No new leads right now.</p>
                ) : (
                  <div className="space-y-3">
                    {data.newLeads.map((lead: any) => (
                      <Link key={lead.id} href={`/customers/${lead.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{lead.name}</p>
                          <p className="text-xs text-muted-foreground">{lead.service_type ?? "General"}</p>
                        </div>
                        <div className="shrink-0"><LeadStatusBadge status={lead.status} /></div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Follow-Ups Needed — admin+ only */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-warning" />
                    Follow-Ups Needed
                  </span>
                  <Link href="/customers?status=Follow-Up+Needed" className="text-xs text-primary hover:underline">View all</Link>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.followUps.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No follow-ups needed.</p>
                ) : (
                  <div className="space-y-3">
                    {data.followUps.map((c: any) => (
                      <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.phone ?? "No phone"}</p>
                        </div>
                        <Badge variant="warning" className="shrink-0">Follow-Up</Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Pending Estimates */}
          {canViewEstimates && <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  Pending Estimates
                </span>
                <Link href="/estimates?status=sent" className="text-xs text-primary hover:underline">View all</Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.pendingEstimates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No pending estimates.</p>
              ) : (
                <div className="space-y-3">
                  {data.pendingEstimates.map((est: any) => (
                    <Link key={est.id} href={`/estimates/${est.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{est.title}</p>
                        <p className="text-xs text-muted-foreground truncate">{(est.customer as any)?.name}</p>
                      </div>
                      <span className="text-sm font-semibold shrink-0 tabular-nums">{formatCurrency(est.total)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>}
        </div>
      </div>
    </div>
  )
}
