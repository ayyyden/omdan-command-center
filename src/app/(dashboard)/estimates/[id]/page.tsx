import { notFound, redirect } from "next/navigation"
import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { EstimateStatusUpdater } from "@/components/estimates/estimate-status-updater"
import { ReviseEstimateButton } from "@/components/estimates/revise-estimate-button"
import { EstimateActions } from "@/components/estimates/estimate-actions"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Pencil, Clock, CheckCircle2, XCircle, Briefcase } from "lucide-react"
import Link from "next/link"
import type { EstimateLineItem, ProjectManager } from "@/types"
import { CommunicationLogSection } from "@/components/shared/communication-log-section"
import { FileSection } from "@/components/shared/file-section"
import { AuditTrailSection } from "@/components/shared/audit-trail-section"
import { PdfActions } from "@/components/estimates/pdf-actions"
import { EstimateMobileActions } from "@/components/estimates/estimate-mobile-actions"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EstimateDetailPage({ params }: PageProps) {
  const { id } = await params

  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "estimates:view")) redirect("/access-denied")
  const { userId, role, pmId, supabase } = session

  const [{ data: estimate }, { data: pms }, { data: linkedJob }, { data: templates }, { data: companySettings }, { data: commLogs }] = await Promise.all([
    supabase
      .from("estimates")
      .select("*, customer:customers(id, name, address, email), revised_from:estimates!revised_from_id(id, title)")
      .eq("id", id)
      .single(),
    supabase
      .from("project_managers")
      .select("*")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("jobs")
      .select("id, title, project_manager_id")
      .eq("estimate_id", id)
      .maybeSingle(),
    supabase.from("message_templates").select("id, name, type, subject, body").eq("is_active", true).order("name"),
    supabase.from("company_settings").select("company_name, phone, email, license_number, logo_url, address, google_review_link").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("communication_logs").select("id, created_at, type, subject, body, channel").eq("estimate_id", id).order("created_at", { ascending: false }),
  ])

  if (!estimate) notFound()

  // PM scope enforcement — verify this estimate belongs to the PM's job or was created by them
  if (role === "project_manager") {
    if (linkedJob) {
      if ((linkedJob as any).project_manager_id !== pmId) redirect("/access-denied")
    } else {
      if (estimate.user_id !== userId) redirect("/access-denied")
    }
  }

  const lineItems = (estimate.line_items ?? []) as EstimateLineItem[]
  const revisedFrom = (estimate as any).revised_from as { id: string; title: string } | null

  const linesByCategory = lineItems.reduce((acc, item) => {
    const cat = item.category
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(item)
    return acc
  }, {} as Record<string, EstimateLineItem[]>)

  const cs   = companySettings as any
  const cust = estimate.customer as any
  const tplData = {
    customer_name:  cust?.name             ?? "",
    estimate_total: formatCurrency(Number(estimate.total ?? 0)),
    company_name:   cs?.company_name       ?? "",
    company_phone:  cs?.phone              ?? "",
    sender_name:    cs?.company_name       ?? "",
    sender_phone:   "9512920703",
    sender_email:   cs?.email             ?? "",
    review_link:    cs?.google_review_link ?? "",
  }
  const tpls = templates ?? []
  const lctx = { customerId: estimate.customer_id, estimateId: estimate.id }

  return (
    <div className="overflow-x-hidden">
      <Topbar
        title={estimate.title}
        subtitle={cust?.name}
        actions={
          <>
            {/* Mobile: status updater + consolidated more menu */}
            <div className="flex items-center gap-1.5 sm:hidden">
              <EstimateStatusUpdater
                estimateId={estimate.id}
                customerId={estimate.customer_id}
                estimateTitle={estimate.title}
                currentStatus={estimate.status}
                projectManagers={(pms ?? []) as ProjectManager[]}
                userId={userId}
                hasExistingJob={!!linkedJob}
              />
              <EstimateMobileActions
                estimateId={estimate.id}
                estimateTitle={estimate.title}
                estimateStatus={estimate.status}
                userId={userId}
                customerEmail={cust?.email ?? null}
                customerName={cust?.name ?? ""}
                templates={tpls}
                tplData={tplData}
                logContext={lctx}
              />
            </div>
            {/* Desktop: all actions */}
            <div className="hidden sm:flex items-center gap-2">
              {estimate.status === "rejected" && (
                <ReviseEstimateButton estimateId={estimate.id} userId={userId} />
              )}
              <EstimateStatusUpdater
                estimateId={estimate.id}
                customerId={estimate.customer_id}
                estimateTitle={estimate.title}
                currentStatus={estimate.status}
                projectManagers={(pms ?? []) as ProjectManager[]}
                userId={userId}
                hasExistingJob={!!linkedJob}
              />
              <Button variant="outline" asChild>
                <Link href={`/estimates/${estimate.id}/edit`}><Pencil className="w-4 h-4 mr-2" />Edit</Link>
              </Button>
              <EstimateActions estimateId={estimate.id} estimateTitle={estimate.title} />
              <PdfActions
                estimateId={estimate.id}
                estimateTitle={estimate.title}
                customerEmail={cust?.email ?? null}
                customerName={cust?.name ?? ""}
                templates={tpls}
                tplData={tplData}
              />
            </div>
          </>
        }
      />

      <div className="p-4 sm:p-6 space-y-4 max-w-3xl">
        {/* Status callouts */}
        {estimate.status === "sent" && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-warning/40 bg-warning/5 text-warning text-sm">
            <Clock className="w-4 h-4 shrink-0" />
            Awaiting customer response.
          </div>
        )}

        {estimate.status === "approved" && !linkedJob && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-success/40 bg-success/5 text-success text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Approved — use <strong className="mx-0.5">Schedule</strong> in the toolbar above to create a job.
          </div>
        )}

        {estimate.status === "approved" && linkedJob && (
          <div className="flex items-center justify-between p-3 rounded-lg border border-success/40 bg-success/5">
            <div className="flex items-center gap-2 text-success text-sm">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Approved
            </div>
            <Button asChild size="sm" variant="outline" className="h-7 text-xs gap-1.5">
              <Link href={`/jobs/${linkedJob.id}`}>
                <Briefcase className="w-3.5 h-3.5" />
                View Job: {linkedJob.title}
              </Link>
            </Button>
          </div>
        )}

        {estimate.status === "rejected" && (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
            <XCircle className="w-4 h-4 shrink-0" />
            Rejected — use <strong className="mx-0.5">Revise</strong> in the toolbar above to create a new draft.
          </div>
        )}

        {/* Header Card */}
        <Card>
          <CardContent className="pt-6 grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Customer</p>
              <Link href={`/customers/${estimate.customer_id}`} className="text-sm font-medium hover:text-primary">
                {(estimate.customer as any)?.name}
              </Link>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p className="text-sm font-medium">{formatDate(estimate.created_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sent</p>
              <p className="text-sm font-medium">{estimate.sent_at ? formatDate(estimate.sent_at) : "Not yet"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Approved</p>
              <p className="text-sm font-medium">{estimate.approved_at ? formatDate(estimate.approved_at) : "—"}</p>
            </div>
            {revisedFrom && (
              <div className="col-span-2 sm:col-span-4 pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-0.5">Revised from</p>
                <Link href={`/estimates/${revisedFrom.id}`} className="text-sm font-medium hover:text-primary flex items-center gap-1">
                  {revisedFrom.title}
                  <span className="text-muted-foreground text-xs">→ original</span>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scope */}
        {estimate.scope_of_work && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Scope of Work</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{estimate.scope_of_work}</p>
            </CardContent>
          </Card>
        )}

        {/* Line Items */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(linesByCategory).map(([category, items]) => (
              <div key={category}>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 capitalize">{category}</p>
                <div className="space-y-1">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center justify-between text-sm py-1">
                      <span className="flex-1">{item.description}</span>
                      <span className="text-muted-foreground mx-4">{item.quantity} × {formatCurrency(item.unit_price)}</span>
                      <span className="font-medium w-24 text-right">{formatCurrency(item.quantity * item.unit_price)}</span>
                    </div>
                  ))}
                </div>
                <Separator className="mt-2" />
              </div>
            ))}

            {/* Totals */}
            <div className="space-y-2 pt-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatCurrency(Number(estimate.subtotal))}</span>
              </div>
              {Number(estimate.markup_percent) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Markup ({estimate.markup_percent}%)</span>
                  <span>{formatCurrency(Number(estimate.markup_amount))}</span>
                </div>
              )}
              {Number(estimate.tax_percent) > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Tax ({estimate.tax_percent}%)</span>
                  <span>{formatCurrency(Number(estimate.tax_amount))}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatCurrency(Number(estimate.total))}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {estimate.notes && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{estimate.notes}</p>
            </CardContent>
          </Card>
        )}

        <FileSection entityType="estimates" entityId={estimate.id} userId={userId} />

        <CommunicationLogSection logs={commLogs ?? []} />

        {["owner", "admin"].includes(role) && (
          <AuditTrailSection documentType="estimate" documentId={estimate.id} />
        )}
      </div>
    </div>
  )
}
