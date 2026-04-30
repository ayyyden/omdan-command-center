import { notFound } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { JobStatusBadge } from "@/components/shared/status-badge"
import { InvoiceStatusBadge } from "@/components/invoices/invoice-status-badge"
import { formatCurrency, formatDate, calcProfitMargin, getTodayLA } from "@/lib/utils"
import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, DollarSign,
  FileText, FilePlus, Pencil, Receipt, TrendingUp,
} from "lucide-react"
import Link from "next/link"
import type { JobStatus, ExpenseCategory, InvoiceWithBalance } from "@/types"
import { UseTemplateButton } from "@/components/templates/use-template-button"
import { QuickCopyButton } from "@/components/templates/quick-copy-button"
import { CommunicationLogSection } from "@/components/shared/communication-log-section"
import { JobContractsSection } from "@/components/jobs/job-contracts-section"
import { FileSection } from "@/components/shared/file-section"
import { JobStatusUpdater } from "@/components/jobs/job-status-updater"
import { JobActions } from "@/components/jobs/job-actions"
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog"
import { AddPaymentDialog } from "@/components/payments/add-payment-dialog"
import { AddInvoiceDialog } from "@/components/invoices/add-invoice-dialog"
import { InvoiceActions } from "@/components/invoices/invoice-actions"
import { NewChangeOrderDialog } from "@/components/change-orders/change-order-dialog"
import { RegenerateTokenButton } from "@/components/change-orders/regenerate-token-button"
import { ReceiptsSection } from "@/components/receipts/receipts-section"
import { ReviewStatusSection } from "@/components/jobs/review-status-section"
import { JobTotalOverride } from "@/components/jobs/job-total-override"
import { JobMobileActions } from "@/components/jobs/job-mobile-actions"
import { getSessionMember, hasJobScope } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"

interface PageProps {
  params: Promise<{ id: string }>
}

function formatJobTime(t: string): string {
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function formatRelativeTime(isoStr: string): string {
  const date = new Date(isoStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return "just now"
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
}

const TYPE_LABEL: Record<string, string> = {
  deposit: "Deposit",
  progress: "Progress",
  final: "Final",
}

const ACTION_ICON: Record<string, React.ReactNode> = {
  status_changed:   <span className="text-[10px]">⇄</span>,
  schedule_updated: <CalendarDays className="w-3 h-3" />,
  pm_changed:       <span className="text-[10px]">👤</span>,
  created:          <span className="text-[10px]">＋</span>,
  invoice_created:  <FilePlus className="w-3 h-3" />,
  updated:          <Pencil className="w-3 h-3" />,
  payment_added:    <DollarSign className="w-3 h-3" />,
  expense_added:    <Receipt className="w-3 h-3" />,
}

// Actions that reveal financial data — hidden from non-admin in activity log
const FINANCIAL_ACTIONS = new Set(["payment_added", "expense_added", "invoice_created"])

export default async function JobDetailPage({ params }: PageProps) {
  const { id } = await params

  const session = await getSessionMember()
  if (!session) redirect("/login")
  const { userId, role, pmId, supabase } = session

  const isAdmin = can(role, "jobs:view_financials")
  const canSubmitExpense = can(role, "expenses:create")

  const empty = { data: [] as any[] }

  // Build activity log query — exclude financial actions for non-admin
  const activityBaseQ = supabase
    .from("activity_log")
    .select("id, created_at, action, description")
    .eq("job_id", id)
    .order("created_at", { ascending: false })
    .limit(30)

  const activityQuery = isAdmin
    ? activityBaseQ
    : activityBaseQ
        .neq("action", "payment_added")
        .neq("action", "expense_added")
        .neq("action", "invoice_created")

  const [
    { data: job },
    { data: expenses },
    { data: payments },
    { data: rawInvoices },
    { data: activityLog },
    { data: companySettings },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("*, customer:customers(id, name, phone, email), estimate:estimates(id, title, total), project_manager:project_managers(name, color, email)")
      .eq("id", id)
      .single(),
    isAdmin ? supabase.from("expenses").select("*").eq("job_id", id).order("date", { ascending: false }) : empty,
    isAdmin ? supabase.from("payments").select("*, invoice:invoices(type)").eq("job_id", id).order("date", { ascending: false }) : empty,
    isAdmin ? supabase.from("invoices").select("*, payments(amount), invoice_number, payment_methods").eq("job_id", id).order("created_at") : empty,
    activityQuery,
    supabase.from("company_settings").select("default_invoice_notes, company_name, phone, email, google_review_link").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ])

  const [{ data: jobTemplates }, { data: commLogs }, { data: changeOrders }, { data: contractTemplates }, { data: sentContracts }] = await Promise.all([
    supabase.from("message_templates").select("id, name, type, subject, body").eq("is_active", true).order("name"),
    supabase.from("communication_logs").select("id, created_at, type, subject, body, channel").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("change_orders").select("id, title, description, amount, status, approved_at, rejected_at, sent_at, created_at").eq("job_id", id).order("created_at", { ascending: false }),
    supabase.from("contract_templates").select("id, name").eq("is_active", true).order("name"),
    supabase.from("sent_contracts").select("id, sent_at, signed_at, signer_name, status, recipient_email, contract_template:contract_templates(name)").eq("job_id", id).order("sent_at", { ascending: false }),
  ])

  if (!job) notFound()

  // PM scope enforcement — block access to jobs not assigned to this PM
  if (hasJobScope(role) && (job as any).project_manager_id !== pmId) redirect("/access-denied")

  // Financial calculations — only meaningful for admin; others get zeros
  const invoicesWithBalance: InvoiceWithBalance[] = (rawInvoices ?? []).map((inv) => {
    const paid = ((inv.payments ?? []) as { amount: unknown }[])
      .reduce((sum, p) => sum + Number(p.amount), 0)
    return {
      id:               inv.id,
      created_at:       inv.created_at,
      user_id:          inv.user_id,
      job_id:           inv.job_id,
      customer_id:      inv.customer_id,
      type:             inv.type,
      status:           inv.status,
      amount:           Number(inv.amount),
      due_date:         inv.due_date,
      notes:            inv.notes,
      amount_paid:      paid,
      amount_remaining: Math.max(0, Number(inv.amount) - paid),
      invoice_number:   inv.invoice_number ?? null,
      payment_methods:  inv.payment_methods ?? [],
    }
  })

  const totalInvoiced       = invoicesWithBalance.reduce((sum, inv) => sum + inv.amount, 0)
  const totalInvoicePaid    = invoicesWithBalance.reduce((sum, inv) => sum + inv.amount_paid, 0)
  const invoiceOutstanding  = Math.max(0, totalInvoiced - totalInvoicePaid)

  const estimateTotal    = Number((job.estimate as any)?.total ?? 0)
  const approvedCOTotal  = (changeOrders ?? []).filter((co) => co.status === "approved").reduce((sum, co) => sum + Number(co.amount), 0)
  const calculatedTotal  = estimateTotal + approvedCOTotal
  const manualTotal      = (job as any).manual_total != null ? Number((job as any).manual_total) : null
  const contractValue    = manualTotal ?? calculatedTotal
  const totalExpenses    = (expenses ?? []).reduce((sum, e) => sum + Number(e.amount), 0)
  const totalPayments    = (payments ?? []).reduce((sum, p) => sum + Number(p.amount), 0)
  const grossProfit      = totalPayments - totalExpenses
  const profitMargin     = calcProfitMargin(totalPayments, totalExpenses)
  const amountUnpaid     = Math.max(0, contractValue - totalPayments)
  const isFullyPaid      = isAdmin && job.status === "completed" && contractValue > 0 && totalPayments >= contractValue

  const cs = companySettings as any
  const pm = job.project_manager as any
  const jobTplData = {
    customer_name:   (job.customer as any)?.name ?? "",
    job_title:       job.title,
    scheduled_date:  job.scheduled_date ? formatDate(job.scheduled_date) : "",
    invoice_balance: formatCurrency(invoiceOutstanding),
    company_name:    cs?.company_name ?? "",
    company_phone:   cs?.phone        ?? "",
    sender_name:     pm?.name                  || cs?.company_name || "",
    sender_phone:    "9512920703",
    sender_email:    pm?.email                 || cs?.email        || "",
    review_link:     cs?.google_review_link    ?? "",
  }
  const tpls = jobTemplates ?? []
  const lctx = { customerId: job.customer_id, jobId: job.id }

  const todayLA = getTodayLA()
  const isOverdue =
    !!job.scheduled_date &&
    job.scheduled_date < todayLA &&
    (job.status === "scheduled" || job.status === "in_progress")

  const expensesByCategory = (expenses ?? []).reduce<Record<string, number>>((acc, e) => {
    const cat = e.category as ExpenseCategory
    acc[cat] = (acc[cat] ?? 0) + Number(e.amount)
    return acc
  }, {})

  return (
    <div className="overflow-x-hidden">
      <Topbar
        title={job.title}
        subtitle={(job.customer as any)?.name}
        actions={
          <>
            {/* Mobile: icon-only edit + consolidated more menu */}
            <div className="flex items-center gap-1.5 sm:hidden">
              <Link href={`/jobs/${job.id}/edit`}>
                <Button size="sm" variant="outline" className="px-2.5" aria-label="Edit">
                  <Pencil className="w-4 h-4" />
                </Button>
              </Link>
              <JobMobileActions
                jobId={job.id}
                jobTitle={job.title}
                isArchived={job.is_archived ?? false}
                templates={tpls}
                data={jobTplData}
                logContext={lctx}
              />
            </div>
            {/* Desktop: all actions */}
            <div className="hidden sm:flex items-center gap-2">
              <Link href={`/jobs/${job.id}/edit`}>
                <Button size="sm" variant="outline" className="gap-1.5">
                  <Pencil className="w-4 h-4" />Edit
                </Button>
              </Link>
              <JobActions jobId={job.id} jobTitle={job.title} isArchived={job.is_archived ?? false} />
              <QuickCopyButton label="Copy Job Reminder"     templateType="job_reminder"     templates={tpls} data={jobTplData} logContext={lctx} />
              <QuickCopyButton label="Copy Payment Reminder" templateType="payment_reminder" templates={tpls} data={jobTplData} logContext={lctx} />
              <UseTemplateButton templates={tpls} preferredType="job_reminder" data={jobTplData} logContext={lctx} />
            </div>
          </>
        }
      />

      <div className="p-4 sm:p-6 space-y-6">
        {/* Command bar */}
        <Card>
          <CardContent className="py-3 px-4">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <div className="flex items-center gap-2">
                <JobStatusBadge status={job.status as JobStatus} />
                {isFullyPaid && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Paid
                  </span>
                )}
                <JobStatusUpdater
                  jobId={job.id}
                  currentStatus={job.status as JobStatus}
                  customerId={job.customer_id}
                  userId={userId}
                />
              </div>
              <div className="hidden sm:block w-px h-5 bg-border shrink-0" />
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: (job.project_manager as any)?.color ?? "#6B7280" }}
                />
                <span className="text-sm font-medium">
                  {(job.project_manager as any)?.name ?? "Unassigned"}
                </span>
              </div>
              <div className="hidden sm:block w-px h-5 bg-border shrink-0" />
              <div className="flex items-center gap-1.5 text-sm">
                <CalendarDays className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span>{job.scheduled_date ? formatDate(job.scheduled_date) : "Not scheduled"}</span>
                {job.scheduled_time && (
                  <span className="text-muted-foreground">at {formatJobTime(job.scheduled_time)}</span>
                )}
              </div>
              {job.estimate_id && (
                <>
                  <div className="hidden sm:block w-px h-5 bg-border shrink-0" />
                  <Link
                    href={`/estimates/${job.estimate_id}`}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    View Estimate
                  </Link>
                </>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Overdue warning */}
        {isOverdue && (
          <div
            className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-sm font-medium"
            style={{
              backgroundColor: "color-mix(in oklch, var(--warning) 12%, transparent)",
              border: "1px solid color-mix(in oklch, var(--warning) 35%, transparent)",
              color: "var(--warning-foreground, var(--foreground))",
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-warning" />
            <span>
              This job is overdue — scheduled for{" "}
              <strong>{formatDate(job.scheduled_date)}</strong> and not yet completed.
            </span>
          </div>
        )}

        {/* Financial stat cards — admin only */}
        {isAdmin && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Contract Value</p>
                <p className="text-lg font-bold">{formatCurrency(contractValue)}</p>
                {manualTotal !== null && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">manually set</p>
                )}
                {manualTotal === null && approvedCOTotal > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    incl. {formatCurrency(approvedCOTotal)} in change orders
                  </p>
                )}
                <JobTotalOverride
                  jobId={job.id}
                  calculatedTotal={calculatedTotal}
                  manualTotal={manualTotal}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Total Collected</p>
                <p className="text-lg font-bold text-success">{formatCurrency(totalPayments)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Unpaid Balance</p>
                <p className={`text-lg font-bold ${amountUnpaid > 0 ? "text-warning" : "text-success"}`}>
                  {formatCurrency(amountUnpaid)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Gross Profit</p>
                <p className={`text-lg font-bold ${grossProfit >= 0 ? "text-success" : "text-destructive"}`}>
                  {formatCurrency(grossProfit)}
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Contract value — PM-visible (customer-facing sold amount only) */}
        {!isAdmin && role === "project_manager" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-sm">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Job Value</p>
                <p className="text-lg font-bold">{formatCurrency(contractValue)}</p>
                {approvedCOTotal > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    incl. {formatCurrency(approvedCOTotal)} in change orders
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Review Request */}
        {job.status === "completed" && (
          <ReviewStatusSection
            jobId={job.id}
            reviewRequestedAt={(job as any).review_requested_at ?? null}
            reviewCompleted={(job as any).review_completed ?? false}
            templates={tpls}
            data={jobTplData}
            logContext={lctx}
            googleReviewLink={cs?.google_review_link ?? null}
            customerEmail={(job.customer as any)?.email ?? null}
          />
        )}

        {/* Change Orders */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <ClipboardList className="w-4 h-4" />
                Change Orders ({changeOrders?.length ?? 0})
              </CardTitle>
              <NewChangeOrderDialog
                jobId={job.id}
                customerName={(job.customer as any)?.name ?? "Customer"}
                customerEmail={(job.customer as any)?.email ?? null}
                companyName={companySettings?.company_name ?? null}
              />
            </div>
          </CardHeader>
          <CardContent>
            {!changeOrders || changeOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No change orders yet.</p>
            ) : (
              <div className="divide-y divide-border/50">
                {changeOrders.map((co) => {
                  const statusMap: Record<string, { label: string; className: string }> = {
                    draft:    { label: "Draft",    className: "bg-muted text-muted-foreground" },
                    sent:     { label: "Sent",     className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
                    approved: { label: "Approved", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
                    rejected: { label: "Declined", className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
                  }
                  const cfg = statusMap[co.status] ?? statusMap.draft
                  const date = co.approved_at ?? co.rejected_at ?? co.sent_at ?? co.created_at
                  return (
                    <div key={co.id} className="group flex flex-wrap items-center gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide shrink-0 ${cfg.className}`}>
                          {cfg.label}
                        </span>
                        <span className="font-medium text-sm truncate">{co.title}</span>
                      </div>
                      <div className="flex items-center gap-3 ml-auto shrink-0">
                        <RegenerateTokenButton coId={co.id} status={co.status} />
                        <span className="font-bold tabular-nums text-base">
                          {formatCurrency(Number(co.amount))}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(date.split("T")[0])}
                        </span>
                      </div>
                    </div>
                  )
                })}
                {approvedCOTotal > 0 && (
                  <>
                    <Separator className="my-1" />
                    <div className="flex justify-between text-sm font-semibold pt-1 px-0.5">
                      <span>Approved Total</span>
                      <span className="text-success tabular-nums">{formatCurrency(approvedCOTotal)}</span>
                    </div>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contracts — admin only */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FilePlus className="w-4 h-4" />
                Contracts ({sentContracts?.length ?? 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <JobContractsSection
                contracts={(contractTemplates ?? []) as { id: string; name: string }[]}
                sentContracts={(sentContracts ?? []) as any[]}
                customerId={job.customer_id}
                jobId={job.id}
                customerEmail={(job.customer as any)?.email ?? null}
                customerName={(job.customer as any)?.name ?? "Customer"}
                companyName={cs?.company_name ?? null}
              />
            </CardContent>
          </Card>
        )}

        {/* Invoices — admin only */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Invoices ({invoicesWithBalance.length})
                </CardTitle>
                <AddInvoiceDialog
                  jobId={job.id}
                  customerId={job.customer_id}
                  userId={userId}
                  estimateTotal={estimateTotal}
                  existingInvoicesTotal={totalInvoiced}
                  size="sm"
                  defaultNotes={companySettings?.default_invoice_notes ?? undefined}
                />
              </div>
            </CardHeader>
            <CardContent>
              {invoicesWithBalance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invoices yet. Create one to start billing.</p>
              ) : (
                <div className="divide-y divide-border/50">
                  {invoicesWithBalance.map((inv) => (
                    <div key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                      {/* Type + amount + status */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground w-14 shrink-0">
                          {TYPE_LABEL[inv.type]}
                        </span>
                        <span className="font-bold tabular-nums text-base">{formatCurrency(inv.amount)}</span>
                        <InvoiceStatusBadge status={inv.status} />
                      </div>

                      {/* Paid / remaining */}
                      <div className="flex items-center gap-2 text-xs tabular-nums">
                        {inv.amount_paid > 0 ? (
                          <>
                            <span className="text-success font-medium">{formatCurrency(inv.amount_paid)} paid</span>
                            {inv.amount_remaining > 0 && (
                              <><span className="text-muted-foreground">·</span>
                              <span className="text-warning font-medium">{formatCurrency(inv.amount_remaining)} due</span></>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">No payments yet</span>
                        )}
                        {inv.due_date && (
                          <><span className="text-muted-foreground">·</span>
                          <span className="text-muted-foreground">Due {formatDate(inv.due_date)}</span></>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 ml-auto shrink-0">
                        <InvoiceActions
                          invoice={inv}
                          customerEmail={(job.customer as any)?.email ?? null}
                          customerName={(job.customer as any)?.name ?? ""}
                          jobTitle={job.title}
                          companyName={cs?.company_name ?? null}
                        />
                        {inv.status !== "paid" && (
                          <AddPaymentDialog
                            jobId={job.id}
                            customerId={job.customer_id}
                            userId={userId}
                            size="sm"
                            invoices={invoicesWithBalance}
                            preselectedInvoiceId={inv.id}
                          />
                        )}
                      </div>
                    </div>
                  ))}

                  <Separator className="my-1" />
                  <div className="grid grid-cols-3 gap-4 px-2 pt-1">
                    <div>
                      <p className="text-xs text-muted-foreground">Total Invoiced</p>
                      <p className="font-semibold tabular-nums">{formatCurrency(totalInvoiced)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total Paid</p>
                      <p className="font-semibold tabular-nums text-success">{formatCurrency(totalInvoicePaid)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Outstanding</p>
                      <p className={`font-semibold tabular-nums ${invoiceOutstanding > 0 ? "text-warning" : "text-success"}`}>
                        {formatCurrency(invoiceOutstanding)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Job Details */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Job Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Customer</p>
                  {/* Customer link hidden from non-admin since /customers is admin-only */}
                  {isAdmin ? (
                    <Link href={`/customers/${job.customer_id}`} className="font-medium hover:text-primary">
                      {(job.customer as any)?.name}
                    </Link>
                  ) : (
                    <p className="font-medium">{(job.customer as any)?.name}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Completed</p>
                  <p className="font-medium">{job.completion_date ? formatDate(job.completion_date) : "Not yet"}</p>
                </div>
              </div>
              {job.notes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Notes</p>
                  <p className="whitespace-pre-wrap">{job.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Profit Summary — admin only */}
          {isAdmin && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />Profit Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Received</span>
                  <span className="font-medium text-success">{formatCurrency(totalPayments)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Expenses</span>
                  <span className="font-medium text-destructive">{formatCurrency(totalExpenses)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-semibold">
                  <span>Gross Profit</span>
                  <span className={grossProfit >= 0 ? "text-success" : "text-destructive"}>
                    {formatCurrency(grossProfit)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Profit Margin</span>
                  <span className="font-medium">{profitMargin}%</span>
                </div>
                {Object.keys(expensesByCategory).length > 0 && (
                  <>
                    <Separator />
                    <p className="text-xs font-medium text-muted-foreground">By Category</p>
                    {Object.entries(expensesByCategory).map(([cat, amt]) => (
                      <div key={cat} className="flex justify-between text-xs">
                        <span className="capitalize text-muted-foreground">{cat.replace(/_/g, " ")}</span>
                        <span>{formatCurrency(amt)}</span>
                      </div>
                    ))}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Expenses — admin sees full list; PM/FW see submit-only */}
        {isAdmin ? (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Receipt className="w-4 h-4" />Expenses ({expenses?.length ?? 0})
                </CardTitle>
                <AddExpenseDialog jobId={job.id} userId={userId} size="sm" />
              </div>
            </CardHeader>
            <CardContent>
              {!expenses || expenses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No expenses recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {expenses.map((exp) => (
                    <div key={exp.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-muted/50">
                      <div>
                        <p className="font-medium">{exp.description}</p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {exp.category.replace(/_/g, " ")} · {formatDate(exp.date)}
                        </p>
                      </div>
                      <span className="font-semibold text-destructive">{formatCurrency(Number(exp.amount))}</span>
                    </div>
                  ))}
                  <Separator />
                  <div className="flex justify-between text-sm font-bold px-2">
                    <span>Total</span>
                    <span>{formatCurrency(totalExpenses)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ) : canSubmitExpense ? (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Receipt className="w-4 h-4" />Submit an Expense
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Record a job-related expense or material cost.
              </p>
              <AddExpenseDialog jobId={job.id} userId={userId} size="sm" />
            </CardContent>
          </Card>
        ) : null}

        {/* Payments — admin only */}
        {isAdmin && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />Payments ({payments?.length ?? 0})
                </CardTitle>
                <AddPaymentDialog
                  jobId={job.id}
                  customerId={job.customer_id}
                  userId={userId}
                  size="sm"
                  invoices={invoicesWithBalance}
                />
              </div>
            </CardHeader>
            <CardContent>
              {!payments || payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {payments.map((pmt) => {
                    const invoiceType = (pmt.invoice as any)?.type as string | undefined
                    return (
                      <div key={pmt.id} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-muted/50">
                        <div>
                          <p className="font-medium capitalize">{pmt.method.replace(/_/g, " ")}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(pmt.date)}
                            {invoiceType && ` · ${TYPE_LABEL[invoiceType] ?? invoiceType} invoice`}
                            {pmt.notes ? ` · ${pmt.notes}` : ""}
                          </p>
                        </div>
                        <span className="font-semibold text-success">{formatCurrency(Number(pmt.amount))}</span>
                      </div>
                    )
                  })}
                  <Separator />
                  <div className="flex justify-between text-sm font-bold px-2">
                    <span>Total</span>
                    <span className="text-success">{formatCurrency(totalPayments)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Activity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" />Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {!activityLog || activityLog.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {activityLog.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-3">
                    <div
                      className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 text-muted-foreground"
                      style={{ fontSize: 10 }}
                    >
                      {ACTION_ICON[entry.action] ?? <span>·</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-snug">{entry.description}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatRelativeTime(entry.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <ReceiptsSection userId={userId} jobId={job.id} />

        <FileSection
          entityType="jobs"
          entityId={job.id}
          userId={userId}
          linkedEntities={
            job.estimate_id
              ? [{
                  entityType: "estimates" as const,
                  entityId: job.estimate_id,
                  label: `Estimate: ${(job.estimate as any)?.title ?? "Estimate"}`,
                }]
              : []
          }
        />

        <CommunicationLogSection logs={commLogs ?? []} />
      </div>
    </div>
  )
}
