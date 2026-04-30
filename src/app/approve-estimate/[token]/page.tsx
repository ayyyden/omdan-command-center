import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/service"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { ApproveClient } from "./approve-client"
import type { EstimateLineItem } from "@/types"

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
}

export default async function ApproveEstimatePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: estimate } = await supabase
    .from("estimates")
    .select(`
      id, title, status, scope_of_work, notes, total, subtotal,
      markup_percent, markup_amount, tax_percent, tax_amount,
      line_items, approved_at, created_at, user_id, approval_token,
      customer:customers(name, email, phone, address)
    `)
    .eq("approval_token", token)
    .single()

  if (!estimate) notFound()

  const hdrs = await headers()
  const customer0 = estimate.customer as unknown as { name: string; email: string | null } | null
  void logAudit({
    documentType:  "estimate",
    documentId:    estimate.id,
    tokenHash:     hashToken(token),
    action:        "viewed",
    customerName:  customer0?.name  ?? null,
    customerEmail: customer0?.email ?? null,
    ipAddress:     getIp(hdrs),
    userAgent:     getUa(hdrs),
    metadata:      (estimate.status === "approved" || estimate.status === "rejected")
                     ? { alreadyResponded: true, status: estimate.status }
                     : undefined,
  })

  const [{ data: company }, { data: paymentSteps }] = await Promise.all([
    supabase
      .from("company_settings")
      .select("company_name, phone, email, address, logo_url, license_number")
      .eq("user_id", estimate.user_id)
      .single(),
    supabase
      .from("estimate_payment_steps")
      .select("id, name, amount, description, sort_order")
      .eq("estimate_id", estimate.id)
      .order("sort_order"),
  ])

  const customer = estimate.customer as unknown as {
    name: string
    email: string | null
    phone: string | null
    address: string | null
  } | null

  const lineItems = (estimate.line_items ?? []) as EstimateLineItem[]
  const hasMarkup = Number(estimate.markup_amount) > 0
  const hasTax = Number(estimate.tax_amount) > 0
  const hasNotes = !!estimate.notes?.trim()
  const hasScopeOfWork = !!estimate.scope_of_work?.trim()

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Company header */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start gap-4">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt={company.company_name ?? "Company logo"}
                className="w-14 h-14 rounded-xl object-contain shrink-0 border border-gray-100"
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                {company?.company_name ?? "Estimate"}
              </h1>
              {company?.address && (
                <p className="text-sm text-gray-500 mt-0.5">{company.address}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                {company?.phone && (
                  <a href={`tel:${company.phone}`} className="text-sm text-gray-500 hover:text-gray-700">
                    {company.phone}
                  </a>
                )}
                {company?.email && (
                  <a href={`mailto:${company.email}`} className="text-sm text-gray-500 hover:text-gray-700">
                    {company.email}
                  </a>
                )}
              </div>
              {company?.license_number && (
                <p className="text-xs text-gray-400 mt-1">Lic. {company.license_number}</p>
              )}
            </div>
          </div>
        </div>

        {/* Estimate summary card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Title bar */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
                  Estimate
                </p>
                <h2 className="text-xl font-bold text-gray-900 leading-tight">{estimate.title}</h2>
                {customer?.name && (
                  <p className="text-sm text-gray-500 mt-1">Prepared for {customer.name}</p>
                )}
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-bold text-gray-900">{fmt(Number(estimate.total))}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {new Date(estimate.created_at).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>

          {/* Scope of work */}
          {hasScopeOfWork && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Scope of Work
              </p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {estimate.scope_of_work}
              </p>
            </div>
          )}

          {/* Line items */}
          {lineItems.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Line Items
              </p>
              <div className="space-y-2">
                {lineItems.map((item, i) => (
                  <div key={item.id ?? i} className="flex items-start justify-between gap-4 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-800 font-medium leading-snug">{item.description}</p>
                      <p className="text-gray-400 text-xs mt-0.5 capitalize">
                        {item.category} · {item.quantity} × {fmt(item.unit_price)}
                      </p>
                    </div>
                    <p className="text-gray-900 font-semibold shrink-0 tabular-nums">
                      {fmt(item.quantity * item.unit_price)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="px-6 py-4 border-b border-gray-100 space-y-2">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span>
              <span className="tabular-nums">{fmt(Number(estimate.subtotal))}</span>
            </div>
            {hasMarkup && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Markup ({estimate.markup_percent}%)</span>
                <span className="tabular-nums">{fmt(Number(estimate.markup_amount))}</span>
              </div>
            )}
            {hasTax && (
              <div className="flex justify-between text-sm text-gray-600">
                <span>Tax ({estimate.tax_percent}%)</span>
                <span className="tabular-nums">{fmt(Number(estimate.tax_amount))}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total</span>
              <span className="tabular-nums">{fmt(Number(estimate.total))}</span>
            </div>
          </div>

          {/* Notes */}
          {hasNotes && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Notes
              </p>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {estimate.notes}
              </p>
            </div>
          )}

          {/* Payment Schedule */}
          {paymentSteps && paymentSteps.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Payment Schedule
              </p>
              <div className="space-y-2">
                {paymentSteps.map((step, i) => (
                  <div key={step.id ?? i} className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{step.name}</p>
                      {step.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                      )}
                    </div>
                    <p className="text-sm font-bold text-gray-900 tabular-nums shrink-0">
                      {fmt(Number(step.amount))}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action area */}
          <div className="px-6 py-6">
            <ApproveClient
              token={token}
              initialStatus={estimate.status}
              approvedAt={estimate.approved_at}
            />
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          Questions? Contact us at{" "}
          {company?.email ? (
            <a href={`mailto:${company.email}`} className="underline hover:text-gray-600">
              {company.email}
            </a>
          ) : (
            company?.company_name ?? "us"
          )}
        </p>
      </div>
    </div>
  )
}
