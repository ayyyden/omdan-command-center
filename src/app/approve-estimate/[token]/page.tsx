import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/service"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { OmdanMark } from "@/components/brand/omdan-mark"
import {
  ESTIMATE_COMPANY, ESTIMATE_TERMS, parseScope, parseNotes, formatMoney, formatLongDate, estimateNumberLabel,
} from "@/lib/estimate-format"
import { ApproveClient } from "./approve-client"
import type { EstimateLineItem } from "@/types"

// The client's estimate link: the same estimate as the PDF, laid out for a
// phone, with "Approve & Sign" at the bottom.
export default async function ApproveEstimatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: estimate } = await supabase
    .from("estimates")
    .select("*, customer:customers(name, email, phone, address)")
    .eq("approval_token", token)
    .single()
  if (!estimate) notFound()

  const customer = estimate.customer as unknown as { name: string; email: string | null; phone: string | null; address: string | null } | null
  const hdrs = await headers()
  await logAudit({
    documentType: "estimate", documentId: estimate.id, tokenHash: hashToken(token), action: "viewed",
    customerName: customer?.name ?? null, customerEmail: customer?.email ?? null,
    ipAddress: getIp(hdrs), userAgent: getUa(hdrs),
    metadata: (estimate.status === "approved" || estimate.status === "rejected") ? { alreadyResponded: true, status: estimate.status } : undefined,
  })

  const { data: steps } = await supabase
    .from("estimate_payment_steps").select("id, name, amount, description, sort_order").eq("estimate_id", estimate.id).order("sort_order")

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const expired = !!estimate.valid_until && estimate.valid_until < today && estimate.status !== "approved" && estimate.status !== "rejected"
  const scope = parseScope(estimate.scope_of_work)
  const notes = parseNotes(estimate.notes)
  const items = (estimate.line_items ?? []) as EstimateLineItem[]
  const number = estimateNumberLabel(estimate.estimate_number)

  const label = "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A88532]"

  return (
    <div className="min-h-screen bg-[#F5F1E7] py-6 sm:py-10 px-3 sm:px-4 text-[#22262A]">
      <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-[#E4DED0] overflow-hidden">
        {/* Letterhead */}
        <div className="px-5 sm:px-8 pt-6 sm:pt-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <OmdanMark className="w-10 h-10" color="#B8913A" id="approve" />
                <div>
                  <p className="font-serif font-bold text-xl tracking-[0.2em] leading-none text-[#1E2320]">OMDAN</p>
                  <p className="text-[10px] tracking-[0.3em] text-[#A88532] mt-1">DEVELOPMENT INC.</p>
                </div>
              </div>
              <p className="text-xs text-[#6B6F73] mt-3 leading-relaxed">
                <a href={`tel:${ESTIMATE_COMPANY.phone.replace(/\D/g, "")}`} className="hover:underline">{ESTIMATE_COMPANY.phone}</a>
                {" · "}
                <a href={`mailto:${ESTIMATE_COMPANY.email}`} className="hover:underline">{ESTIMATE_COMPANY.email}</a>
                <br />CA Contractor License #{ESTIMATE_COMPANY.license}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="font-serif font-bold text-2xl tracking-wider text-[#1E2320]">ESTIMATE</p>
              <dl className="text-xs mt-2 space-y-0.5">
                {number && <div><dt className="inline text-[#6B6F73]">No. </dt><dd className="inline font-semibold">{number}</dd></div>}
                <div><dt className="inline text-[#6B6F73]">Date </dt><dd className="inline font-semibold">{formatLongDate(estimate.created_at)}</dd></div>
                {estimate.valid_until && (
                  <div><dt className="inline text-[#6B6F73]">Valid until </dt><dd className={`inline font-semibold ${expired ? "text-red-600" : ""}`}>{formatLongDate(estimate.valid_until)}</dd></div>
                )}
              </dl>
            </div>
          </div>
          <div className="h-[2px] bg-[#C9A246] mt-5" /><div className="h-px bg-[#C9A246] mt-0.5" />
        </div>

        <div className="px-5 sm:px-8 py-6 space-y-7">
          {/* Prepared for + project */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="rounded-lg border border-[#E4DED0] p-4">
              <p className={label}>Prepared for</p>
              <p className="font-bold mt-1.5">{customer?.name}</p>
              <div className="text-sm text-[#44484C] leading-relaxed">
                {customer?.phone && <p>{customer.phone}</p>}
                {customer?.email && <p className="break-all">{customer.email}</p>}
                {customer?.address && <p>{customer.address}</p>}
              </div>
            </div>
            <div className="rounded-lg border border-[#E4DED0] p-4">
              <p className={label}>Project</p>
              <p className="font-bold mt-1.5">{estimate.title}</p>
              <p className="text-2xl font-bold text-[#1E2320] mt-2">{formatMoney(Number(estimate.total))}</p>
              <p className="text-xs text-[#6B6F73]">Total contract price{steps?.length ? ` · ${steps.length} payments` : ""}</p>
            </div>
          </div>

          {/* Scope */}
          {(scope.sections.length > 0 || scope.intro.length > 0) && (
            <section>
              <p className={label}>Scope of work</p>
              {scope.intro.map((p, i) => <p key={i} className="text-sm mt-3">{p}</p>)}
              <div className="mt-3 space-y-5">
                {scope.sections.map((sec, i) => (
                  <div key={i}>
                    <h3 className="flex items-center gap-2.5 font-bold text-[15px] text-[#1E2320]">
                      <span className="grid place-items-center w-6 h-6 rounded-full bg-[#1E2320] text-white text-[11px] shrink-0">{i + 1}</span>
                      {sec.heading}
                    </h3>
                    <ul className="mt-2 ml-9 space-y-1.5">
                      {sec.bullets.map((b, k) => (
                        <li key={k} className="text-sm leading-relaxed text-[#33373B] flex gap-2.5">
                          <span className="mt-[7px] w-1.5 h-1.5 bg-[#C9A246] shrink-0" />{b}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Line items (only when there are any) */}
          {items.length > 0 && (
            <section>
              <p className={label}>Line items</p>
              <div className="mt-3 rounded-lg border border-[#E4DED0] divide-y divide-[#E4DED0]">
                {items.map((it, i) => (
                  <div key={it.id ?? i} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{it.description} <span className="text-[#6B6F73]">· {it.quantity} × {formatMoney(it.unit_price)}</span></span>
                    <span className="font-semibold tabular-nums">{formatMoney(it.quantity * it.unit_price)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Payment schedule + total */}
          <section>
            <p className={label}>{steps?.length ? "Payment schedule" : "Total"}</p>
            <div className="mt-3 rounded-lg border border-[#E4DED0] overflow-hidden">
              {(steps ?? []).map((p, i) => (
                <div key={p.id} className="flex items-start justify-between gap-3 px-4 py-3 border-b border-[#E4DED0]">
                  <div className="flex gap-3 min-w-0">
                    <span className="text-[#6B6F73] font-semibold text-sm w-4 shrink-0">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">{p.name}</p>
                      {p.description && <p className="text-xs text-[#6B6F73] mt-0.5">{p.description}</p>}
                    </div>
                  </div>
                  <span className="font-semibold text-sm tabular-nums shrink-0">{formatMoney(Number(p.amount))}</span>
                </div>
              ))}
              {Number(estimate.tax_amount) > 0 && (
                <div className="flex justify-between px-4 py-2 text-sm text-[#6B6F73] border-b border-[#E4DED0]">
                  <span>Tax ({estimate.tax_percent}%)</span><span>{formatMoney(Number(estimate.tax_amount))}</span>
                </div>
              )}
              <div className="flex items-center justify-between bg-[#1E2320] px-4 py-3.5">
                <span className="text-white text-xs font-bold tracking-[0.14em]">TOTAL CONTRACT PRICE</span>
                <span className="text-[#C9A246] text-lg font-bold tabular-nums">{formatMoney(Number(estimate.total))}</span>
              </div>
            </div>
          </section>

          {/* Notes */}
          {notes.length > 0 && (
            <section className="rounded-lg bg-[#F5F1E7] p-4">
              <p className={label}>Project notes</p>
              <ul className="mt-2.5 space-y-1.5">
                {notes.map((n, i) => (
                  <li key={i} className="text-sm leading-relaxed flex gap-2.5"><span className="mt-[7px] w-1.5 h-1.5 bg-[#C9A246] shrink-0" />{n}</li>
                ))}
              </ul>
            </section>
          )}

          {/* Terms */}
          <section>
            <p className={label}>Terms</p>
            <ol className="mt-2.5 space-y-1 text-xs text-[#6B6F73] list-decimal ml-4">
              {ESTIMATE_TERMS.map((t, i) => <li key={i}>{t}</li>)}
            </ol>
            <a href={`/api/estimates/public-pdf/${token}`} target="_blank" rel="noopener noreferrer"
              className="inline-block mt-4 text-sm font-medium text-[#A88532] underline underline-offset-2">
              Download the PDF
            </a>
          </section>
        </div>

        {/* Approve & sign */}
        <div className="px-5 sm:px-8 py-6 border-t border-[#E4DED0] bg-[#FBFAF6]">
          <ApproveClient
            token={token}
            initialStatus={estimate.status}
            approvedAt={estimate.approved_at}
            customerName={customer?.name ?? ""}
            signerName={estimate.signer_name ?? null}
            expired={expired}
            validUntil={estimate.valid_until ? formatLongDate(estimate.valid_until) : null}
          />
        </div>
      </div>
      <p className="text-center text-xs text-[#8A8E92] mt-5">
        Questions? Call <a href={`tel:${ESTIMATE_COMPANY.phone.replace(/\D/g, "")}`} className="underline">{ESTIMATE_COMPANY.phone}</a> or email{" "}
        <a href={`mailto:${ESTIMATE_COMPANY.email}`} className="underline">{ESTIMATE_COMPANY.email}</a>
      </p>
    </div>
  )
}
