import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { LeadStatusBadge, EstimateStatusBadge, JobStatusBadge } from "@/components/shared/status-badge"
import { formatCurrency, formatDate, formatPhone } from "@/lib/utils"
import { Phone, Mail, MapPin, Tag, Pencil, Plus, FileText, Briefcase, MessageSquare, Clock } from "lucide-react"
import Link from "next/link"
import type { LeadStatus, JobStatus, EstimateStatus } from "@/types"
import { CustomerActions } from "@/components/customers/customer-actions"
import { UseTemplateButton } from "@/components/templates/use-template-button"
import { QuickCopyButton } from "@/components/templates/quick-copy-button"
import { CommunicationLogSection } from "@/components/shared/communication-log-section"
import { FileSection } from "@/components/shared/file-section"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: customer }, { data: estimates }, { data: jobs }, { data: templates }, { data: companySettings }, { data: commLogs }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).single(),
    supabase.from("estimates").select("*, jobs(id)").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("jobs").select("*").eq("customer_id", id).order("created_at", { ascending: false }),
    supabase.from("message_templates").select("id, name, type, subject, body").eq("is_active", true).order("name"),
    supabase.from("company_settings").select("company_name, phone, email, google_review_link").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("communication_logs").select("id, created_at, type, subject, body, channel").eq("customer_id", id).order("created_at", { ascending: false }),
  ])

  if (!customer) notFound()

  const totalEstimated = (estimates ?? []).filter(e => e.status === "approved").reduce((sum, e) => sum + Number(e.total), 0)

  // ── Unified timeline ──────────────────────────────────────────────────────
  type TimelineEntry = {
    id: string
    date: string
    kind: "estimate" | "job" | "message"
    title: string
    subtitle?: string
    href?: string
  }

  const COMM_TYPE_LABELS: Record<string, string> = {
    estimate_follow_up: "Estimate Follow-up",
    job_scheduled:      "Job Scheduled",
    job_reminder:       "Job Reminder",
    payment_reminder:   "Payment Reminder",
    review_request:     "Review Request",
    custom:             "Custom",
  }

  const SOURCE_LABELS: Record<string, string> = {
    referral: "Referral", google: "Google", facebook: "Facebook",
    instagram: "Instagram", door_knock: "Door Knock", repeat_customer: "Repeat Customer",
    yard_sign: "Yard Sign", nextdoor: "Nextdoor", yelp: "Yelp", other: "Other",
  }

  const timeline: TimelineEntry[] = [
    ...(estimates ?? []).map(e => ({
      id:       `est-${e.id}`,
      date:     e.created_at,
      kind:     "estimate" as const,
      title:    `Estimate: ${e.title}`,
      subtitle: e.status.charAt(0).toUpperCase() + e.status.slice(1),
      href:     `/estimates/${e.id}`,
    })),
    ...(jobs ?? []).map(j => ({
      id:       `job-${j.id}`,
      date:     j.created_at,
      kind:     "job" as const,
      title:    `Job: ${j.title}`,
      subtitle: j.status.replace(/_/g, " "),
      href:     `/jobs/${j.id}`,
    })),
    ...(commLogs ?? []).map(l => ({
      id:       `msg-${l.id}`,
      date:     l.created_at,
      kind:     "message" as const,
      title:    COMM_TYPE_LABELS[l.type] ?? l.type.replace(/_/g, " "),
      subtitle: l.body.slice(0, 80) + (l.body.length > 80 ? "…" : ""),
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div>
      <Topbar
        title={customer.name}
        subtitle={customer.service_type ?? "Customer"}
        actions={
          <div className="flex items-center gap-2">
            <CustomerActions customerId={customer.id} customerName={customer.name} isArchived={customer.is_archived ?? false} />
            {(() => {
              const cs = companySettings as any
              const customerTplData = {
                customer_name: customer.name,
                company_name:  cs?.company_name ?? "",
                company_phone: cs?.phone        ?? "",
                sender_name:   cs?.company_name        ?? "",
                sender_phone:  "9512920703",
                sender_email:  cs?.email              ?? "",
                review_link:   cs?.google_review_link ?? "",
              }
              const tpls = templates ?? []
              const lctx = { customerId: customer.id }
              return (
                <>
                  <QuickCopyButton label="Copy Review Request" templateType="review_request" templates={tpls} data={customerTplData} logContext={lctx} />
                  <UseTemplateButton templates={tpls} data={customerTplData} logContext={lctx} />
                </>
              )
            })()}
            <Button variant="outline" asChild>
              <Link href={`/customers/${customer.id}/edit`}><Pencil className="w-4 h-4 mr-2" />Edit</Link>
            </Button>
            <Button asChild>
              <Link href={`/estimates/new?customer=${customer.id}`}><Plus className="w-4 h-4 mr-2" />New Estimate</Link>
            </Button>
          </div>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Contact Info */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Contact Information</CardTitle>
                <LeadStatusBadge status={customer.status as LeadStatus} />
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {customer.phone && (
                <div className="flex items-center gap-3 text-sm">
                  <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`tel:${customer.phone}`} className="hover:text-primary">{formatPhone(customer.phone)}</a>
                </div>
              )}
              {customer.email && (
                <div className="flex items-center gap-3 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                  <a href={`mailto:${customer.email}`} className="hover:text-primary">{customer.email}</a>
                </div>
              )}
              {customer.address && (
                <div className="flex items-center gap-3 text-sm">
                  <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{customer.address}</span>
                </div>
              )}
              {customer.lead_source && (
                <div className="flex items-center gap-3 text-sm">
                  <Tag className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span>{SOURCE_LABELS[customer.lead_source] ?? customer.lead_source.replace(/_/g, " ")}</span>
                </div>
              )}
              {customer.notes && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-muted-foreground">Added</p>
                <p className="text-sm font-medium">{formatDate(customer.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Estimates</p>
                <p className="text-sm font-medium">{estimates?.length ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Approved Value</p>
                <p className="text-lg font-bold">{formatCurrency(totalEstimated)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Jobs</p>
                <p className="text-sm font-medium">{jobs?.length ?? 0}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Estimates */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" /> Estimates
              </CardTitle>
              <Button size="sm" variant="outline" asChild>
                <Link href={`/estimates/new?customer=${customer.id}`}><Plus className="w-3 h-3 mr-1" />New</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {!estimates || estimates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No estimates yet.</p>
            ) : (
              <div className="space-y-2">
                {estimates.map((est) => {
                  const linkedJobId = (est as any).jobs?.[0]?.id ?? null
                  return (
                    <div key={est.id} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors">
                      <Link href={`/estimates/${est.id}`} className="flex-1 min-w-0 mr-3">
                        <p className="text-sm font-semibold hover:text-primary transition-colors">{est.title}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(est.created_at)}</p>
                      </Link>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold tabular-nums">{formatCurrency(Number(est.total))}</span>
                        <EstimateStatusBadge status={est.status as EstimateStatus} />
                        {linkedJobId && (
                          <Link
                            href={`/jobs/${linkedJobId}`}
                            className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          >
                            <Briefcase className="w-3 h-3" />
                            Job
                          </Link>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Jobs */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Jobs
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!jobs || jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <div className="space-y-2">
                {jobs.map((job) => (
                  <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors border">
                    <div>
                      <p className="text-sm font-medium">{job.title}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(job.scheduled_date)}</p>
                    </div>
                    <JobStatusBadge status={job.status as JobStatus} />
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Activity Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Activity Timeline ({timeline.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <div className="relative pl-5 space-y-0">
                {/* Vertical line */}
                <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

                {timeline.map((entry) => {
                  const icon =
                    entry.kind === "estimate" ? <FileText className="w-3 h-3" /> :
                    entry.kind === "job"      ? <Briefcase className="w-3 h-3" /> :
                                               <MessageSquare className="w-3 h-3" />

                  const inner = (
                    <div className="flex items-start gap-3 py-2.5">
                      <div className="absolute left-0 w-3.5 h-3.5 rounded-full bg-muted border border-border flex items-center justify-center text-muted-foreground mt-0.5">
                        {icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={["text-sm font-medium leading-snug", entry.href ? "hover:text-primary" : ""].join(" ")}>
                          {entry.title}
                        </p>
                        {entry.subtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{entry.subtitle}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">{formatDate(entry.date)}</p>
                      </div>
                    </div>
                  )

                  return (
                    <div key={entry.id} className="relative">
                      {entry.href ? <Link href={entry.href}>{inner}</Link> : inner}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <FileSection
          entityType="customers"
          entityId={customer.id}
          userId={user.id}
          linkedEntities={[
            ...(estimates ?? []).map((e) => ({
              entityType: "estimates" as const,
              entityId: e.id,
              label: `Estimate: ${e.title}`,
            })),
            ...(jobs ?? []).map((j) => ({
              entityType: "jobs" as const,
              entityId: j.id,
              label: `Job: ${j.title}`,
            })),
          ]}
        />

        <CommunicationLogSection logs={commLogs ?? []} />
      </div>
    </div>
  )
}
