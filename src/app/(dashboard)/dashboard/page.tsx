import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { LeadStatusBadge, JobStatusBadge } from "@/components/shared/status-badge"
import { formatCurrency, formatDate, getTodayLA } from "@/lib/utils"
import {
  Users, FileText, Briefcase, DollarSign,
  TrendingUp, AlertCircle, AlertTriangle, Clock, CheckCircle2, CalendarDays, Bell,
} from "lucide-react"
import Link from "next/link"
import type { Customer, Job, Reminder } from "@/types"
import { ReminderRow } from "@/components/reminders/reminder-row"

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

async function getDashboardData(userId: string) {
  const supabase = await createClient()
  const todayLA = getTodayLA()

  const pad = (n: number) => String(n).padStart(2, "0")
  const today = new Date()
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()

  // 7 days from today
  const nextWeek = new Date(today)
  nextWeek.setDate(nextWeek.getDate() + 7)
  const nextWeekStr = `${nextWeek.getFullYear()}-${pad(nextWeek.getMonth() + 1)}-${pad(nextWeek.getDate())}`

  // 3 days ago (for overdue estimates)
  const threeDaysAgo = new Date(today)
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
  const threeDaysAgoISO = threeDaysAgo.toISOString()

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
    { data: recentActivity },
    { data: overdueReminders },
  ] = await Promise.all([
    supabase.from("customers").select("id, name, phone, status, service_type, created_at").eq("user_id", userId).in("status", ["New Lead", "Contacted"]).order("created_at", { ascending: false }).limit(5),
    supabase.from("customers").select("id, name, phone, status, service_type").eq("user_id", userId).eq("status", "Follow-Up Needed").limit(10),
    supabase.from("estimates").select("id, title, total, status, created_at, customer:customers(name)").eq("user_id", userId).eq("status", "sent").order("created_at", { ascending: false }).limit(5),
    supabase.from("estimates").select("id, title, total, updated_at, customer:customers(name)").eq("user_id", userId).eq("status", "sent").lt("updated_at", threeDaysAgoISO).order("updated_at").limit(10),
    supabase.from("jobs").select("id, title, status, scheduled_date, scheduled_time, customer:customers(name)").eq("user_id", userId).eq("scheduled_date", todayLA).order("scheduled_time", { nullsFirst: false }),
    supabase.from("jobs").select("id, title, status, scheduled_date, scheduled_time, customer:customers(name)").eq("user_id", userId).gt("scheduled_date", todayLA).lte("scheduled_date", nextWeekStr).in("status", ["scheduled", "in_progress"]).order("scheduled_date").limit(7),
    supabase.from("jobs").select("id, title, status, scheduled_date, customer:customers(name)").eq("user_id", userId).lt("scheduled_date", todayLA).in("status", ["scheduled", "in_progress"]).order("scheduled_date").limit(10),
    supabase.from("payments").select("amount").eq("user_id", userId).gte("created_at", monthStart),
    supabase.from("expenses").select("amount").eq("user_id", userId).gte("created_at", monthStart),
    supabase.from("jobs").select("id, title, customer:customers(name), estimate:estimates(total), payments:payments(amount)").eq("user_id", userId).neq("status", "cancelled"),
    supabase.from("activity_log").select("id, entity_type, entity_id, job_id, action, description, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8),
    supabase.from("reminders").select("id, title, type, due_date, job_id, estimate_id, customer:customers(name)").eq("user_id", userId).is("completed_at", null).lt("due_date", todayLA).order("due_date").limit(8),
  ])

  const monthRevenue  = (monthPayments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
  const monthExpTotal = (monthExpenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)
  const monthProfit   = monthRevenue - monthExpTotal

  const unpaidTotal = (unpaidJobs ?? []).reduce((sum, job) => {
    const estimateTotal  = Number((job.estimate as any)?.total ?? 0)
    const paymentsTotal  = ((job.payments as any[]) ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    return sum + Math.max(0, estimateTotal - paymentsTotal)
  }, 0)

  return {
    newLeads:         newLeads         ?? [],
    followUps:        followUps        ?? [],
    pendingEstimates: pendingEstimates ?? [],
    overdueEstimates: overdueEstimates ?? [],
    todayJobs:        todayJobs        ?? [],
    upcomingJobs:     upcomingJobs     ?? [],
    overdueJobs:      overdueJobs      ?? [],
    monthRevenue,
    monthProfit,
    unpaidTotal,
    recentActivity:   recentActivity   ?? [],
    overdueReminders: overdueReminders ?? [],
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const data = await getDashboardData(user.id)

  const stats = [
    { label: "Revenue This Month", value: formatCurrency(data.monthRevenue),  icon: DollarSign,    iconClass: "text-success",     bgClass: "bg-success/10" },
    { label: "Profit This Month",  value: formatCurrency(data.monthProfit),   icon: TrendingUp,    iconClass: data.monthProfit >= 0 ? "text-success" : "text-destructive", bgClass: data.monthProfit >= 0 ? "bg-success/10" : "bg-destructive/10" },
    { label: "Unpaid Balances",    value: formatCurrency(data.unpaidTotal),   icon: AlertCircle,   iconClass: "text-warning",     bgClass: "bg-warning/10" },
    { label: "Jobs Today",         value: String(data.todayJobs.length),      icon: Briefcase,     iconClass: "text-primary",     bgClass: "bg-primary/10" },
  ]

  return (
    <div>
      <Topbar title="Dashboard" subtitle="Welcome back — here's your business at a glance" />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <Card key={stat.label}>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className={`flex items-center justify-center w-12 h-12 rounded-full ${stat.bgClass} shrink-0`}>
                  <stat.icon className={`w-6 h-6 ${stat.iconClass}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-2xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
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
                <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-warning/10 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                  <div>
                    <p className="text-sm font-medium">{job.title}</p>
                    <p className="text-xs text-muted-foreground">{(job.customer as any)?.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <JobStatusBadge status={job.status} />
                    <Badge variant="warning">{formatDate(job.scheduled_date)}</Badge>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Overdue Estimates */}
        {data.overdueEstimates.length > 0 && (
          <Card style={{ borderColor: "color-mix(in oklch, var(--warning) 40%, var(--border))", backgroundColor: "color-mix(in oklch, var(--warning) 5%, var(--card))" }}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-warning">
                <FileText className="w-4 h-4" />
                Overdue Estimates — No Response in 3+ Days ({data.overdueEstimates.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.overdueEstimates.map((est: any) => (
                <Link key={est.id} href={`/estimates/${est.id}`} className="flex items-center justify-between hover:bg-warning/10 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                  <div>
                    <p className="text-sm font-medium">{est.title}</p>
                    <p className="text-xs text-muted-foreground">{(est.customer as any)?.name}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold">{formatCurrency(est.total)}</span>
                    <Badge variant="warning">Sent {formatDate(est.updated_at)}</Badge>
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
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <div>
                        <p className="text-sm font-medium">{job.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {(job.customer as any)?.name}
                          {job.scheduled_time && <span className="ml-1">· {formatJobTime(job.scheduled_time)}</span>}
                        </p>
                      </div>
                      <JobStatusBadge status={job.status} />
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
                    <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <div>
                        <p className="text-sm font-medium">{job.title}</p>
                        <p className="text-xs text-muted-foreground">{(job.customer as any)?.name}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{formatDate(job.scheduled_date)}</Badge>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* New Leads */}
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
                    <Link key={lead.id} href={`/customers/${lead.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <div>
                        <p className="text-sm font-medium">{lead.name}</p>
                        <p className="text-xs text-muted-foreground">{lead.service_type ?? "General"}</p>
                      </div>
                      <LeadStatusBadge status={lead.status} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Follow-Ups Needed */}
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
                    <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <div>
                        <p className="text-sm font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.phone ?? "No phone"}</p>
                      </div>
                      <Badge variant="warning">Follow-Up</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pending Estimates */}
          <Card>
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
                    <Link key={est.id} href={`/estimates/${est.id}`} className="flex items-center justify-between hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded-md transition-colors">
                      <div>
                        <p className="text-sm font-medium">{est.title}</p>
                        <p className="text-xs text-muted-foreground">{(est.customer as any)?.name}</p>
                      </div>
                      <span className="text-sm font-semibold">{formatCurrency(est.total)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity */}
        {data.recentActivity.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {data.recentActivity.map((log: any) => {
                  const href = getActivityLink(log)
                  const inner = (
                    <div className="flex items-start gap-3 text-sm py-1.5 px-2 rounded-md">
                      <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <span className="leading-snug">{log.description}</span>
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0 mt-0.5">{formatDate(log.created_at)}</span>
                    </div>
                  )
                  return href ? (
                    <Link key={log.id} href={href} className="block hover:bg-muted/50 rounded-md transition-colors">
                      {inner}
                    </Link>
                  ) : (
                    <div key={log.id}>{inner}</div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
