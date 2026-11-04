// Server-only: the ONE way estimates become a PDF, get stored on the lead
// card, and get emailed — used by the dashboard Send button, the PDF button,
// Lia's send_estimate, and the client's online signing. Keeping it in one
// place is what makes every estimate look the same.

import React from "react"
import { renderToBuffer } from "@react-pdf/renderer"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createServiceClient } from "@/lib/supabase/service"
import { EstimatePDFDocument } from "@/lib/pdf/estimate-document"
import { createTransporter, smtpConfigured } from "@/lib/email"
import { notifyLia } from "@/lib/lia-notifications"
import {
  ESTIMATE_COMPANY, ESTIMATE_VALID_DAYS, estimateNumberLabel, formatMoney, formatLongDate, pacificDatePlus, defaultEstimateEmail,
} from "@/lib/estimate-format"
import type { EstimateLineItem } from "@/types"

export function appBaseUrl(fallback?: string): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? fallback ?? "https://omdan-command-center.vercel.app").replace(/\/$/, "")
}

interface LoadedEstimate {
  id: string; user_id: string; title: string; created_at: string; status: string
  scope_of_work: string | null; notes: string | null; total: number; subtotal: number
  markup_percent: number; markup_amount: number; tax_percent: number; tax_amount: number
  line_items: EstimateLineItem[]; approval_token: string; estimate_number: number | null
  valid_until: string | null; signer_name: string | null; signature_png: string | null; signed_at: string | null
  customer_id: string
  customer: { id: string; name: string; phone: string | null; email: string | null; address: string | null } | null
}

async function loadEstimate(supabase: SupabaseClient, estimateId: string) {
  const [{ data: est, error }, { data: steps }, { data: company }] = await Promise.all([
    supabase.from("estimates").select("*, customer:customers(id, name, phone, email, address)").eq("id", estimateId).single(),
    supabase.from("estimate_payment_steps").select("name, amount, description, sort_order").eq("estimate_id", estimateId).order("sort_order"),
    supabase.from("company_settings").select("company_name, phone, license_number").order("updated_at", { ascending: false }).limit(1).maybeSingle(),
  ])
  if (error || !est) throw new Error("Estimate not found")
  return { est: est as LoadedEstimate, steps: steps ?? [], company }
}

/** Renders the estimate PDF (the chosen Classic Letterhead design). */
export async function buildEstimatePdf(estimateId: string, opts: { supabase?: SupabaseClient; appUrl?: string } = {}) {
  const supabase = opts.supabase ?? createServiceClient()
  const { est, steps, company } = await loadEstimate(supabase, estimateId)
  const signed = !!(est.signature_png && est.signed_at)
  const number = estimateNumberLabel(est.estimate_number)
  const doc = React.createElement(EstimatePDFDocument, {
    estimate: {
      number,
      title:          est.title,
      created_at:     est.created_at,
      valid_until:    est.valid_until,
      scope_of_work:  est.scope_of_work,
      notes:          est.notes,
      line_items:     (est.line_items ?? []) as EstimateLineItem[],
      subtotal:       Number(est.subtotal),
      markup_percent: Number(est.markup_percent),
      markup_amount:  Number(est.markup_amount),
      tax_percent:    Number(est.tax_percent),
      tax_amount:     Number(est.tax_amount),
      total:          Number(est.total),
      payment_steps:  steps.map((p) => ({ name: p.name, amount: Number(p.amount), description: p.description })),
      approval_link:  signed ? null : `${appBaseUrl(opts.appUrl)}/approve-estimate/${est.approval_token}`,
    },
    customer: {
      name:    est.customer?.name ?? "",
      phone:   est.customer?.phone ?? null,
      email:   est.customer?.email ?? null,
      address: est.customer?.address ?? null,
    },
    company: {
      name:    company?.company_name ?? null,
      phone:   company?.phone ?? null,
      license: company?.license_number ?? null,
      email:   ESTIMATE_COMPANY.email,
    },
    signature: signed ? { name: est.signer_name ?? est.customer?.name ?? "", png: est.signature_png!, signedAt: est.signed_at! } : null,
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buffer = await renderToBuffer(doc as React.ReactElement<any>)
  return { buffer, est, steps, number }
}

export function estimateFileName(number: string | null, signed = false): string {
  return `Omdan-Estimate${number ? `-${number}` : ""}${signed ? "-signed" : ""}.pdf`
}

/** Saves the PDF to Storage and lists it in Files on the estimate AND the lead card. */
export async function storeEstimatePdf(opts: {
  supabase?: SupabaseClient; estimateId: string; customerId: string; userId: string
  buffer: Buffer; fileName: string; signed?: boolean
}): Promise<string | null> {
  const supabase = opts.supabase ?? createServiceClient()
  const storagePath = opts.signed ? `estimates/${opts.estimateId}-signed.pdf` : `estimates/${opts.estimateId}.pdf`
  const { error } = await supabase.storage.from("documents").upload(storagePath, opts.buffer, { contentType: "application/pdf", upsert: true })
  if (error) { console.error("[estimate-delivery] upload failed:", error.message); return null }
  const { data: url } = supabase.storage.from("documents").getPublicUrl(storagePath)
  await supabase.from("estimates").update(opts.signed ? { signed_pdf_path: storagePath } : { pdf_url: url.publicUrl }).eq("id", opts.estimateId)
  for (const [entity_type, entity_id] of [["estimates", opts.estimateId], ["customers", opts.customerId]] as const) {
    await supabase.from("file_attachments").upsert({
      user_id: opts.userId, bucket: "documents", storage_path: storagePath, file_name: opts.fileName,
      category: "pdfs", entity_type, entity_id, size_bytes: opts.buffer.byteLength, mime_type: "application/pdf",
    }, { onConflict: "bucket,storage_path,entity_type,entity_id" })
  }
  return url.publicUrl
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

/** Branded email matching the estimate PDF (basalt / brass, Omdan mark). */
export function estimateEmailHtml(opts: {
  heading: string; paragraphs: string[]; facts?: [string, string][]; ctaLabel?: string; ctaUrl?: string; preheader?: string
}): string {
  const mark = `<table cellpadding="0" cellspacing="0"><tr><td style="font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:4px;color:#ffffff;font-weight:bold;">OMDAN</td></tr><tr><td style="font-family:Arial,sans-serif;font-size:9px;letter-spacing:3px;color:#C9A246;padding-top:3px;">DEVELOPMENT INC.</td></tr></table>`
  const facts = (opts.facts ?? []).map(([k, v]) =>
    `<tr><td style="padding:7px 0;color:#6B6F73;font-size:13px;border-bottom:1px solid #ECE6D8;">${esc(k)}</td><td style="padding:7px 0;text-align:right;font-weight:bold;color:#1E2320;font-size:14px;border-bottom:1px solid #ECE6D8;">${esc(v)}</td></tr>`).join("")
  const paras = opts.paragraphs.map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#33373B;">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<table cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr><td style="background:#1E2320;border-radius:6px;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:13px 28px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;font-family:Arial,sans-serif;">${esc(opts.ctaLabel)} &nbsp;<span style="color:#C9A246;">&rarr;</span></a></td></tr></table>`
    : ""
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F5F1E7;font-family:Arial,Helvetica,sans-serif;">
${opts.preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${esc(opts.preheader)}</div>` : ""}
<table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1E7;padding:28px 12px;"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#1E2320;padding:22px 30px;">${mark}</td></tr>
<tr><td style="height:3px;background:#C9A246;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:30px 30px 12px;">
<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:23px;color:#1E2320;font-weight:bold;">${esc(opts.heading)}</h1>
${paras}
${facts ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 4px;">${facts}</table>` : ""}
${cta}
</td></tr>
<tr><td style="padding:20px 30px 26px;border-top:1px solid #ECE6D8;color:#8A8E92;font-size:12px;line-height:1.6;">
${ESTIMATE_COMPANY.name} &middot; CA Lic #${ESTIMATE_COMPANY.license}<br>${ESTIMATE_COMPANY.phone} &middot; ${ESTIMATE_COMPANY.email}
</td></tr></table></td></tr></table></body></html>`
}

/**
 * Sends the estimate: gives it a fresh 15-day validity, builds the PDF,
 * emails it (branded HTML + "Review & Sign" button + PDF attached), saves the
 * PDF to the lead card, marks it sent, logs it, and tells Lia.
 */
export async function sendEstimateEmail(opts: {
  estimateId: string; to: string; subject?: string; body?: string; userId: string; appUrl?: string; via?: "crm" | "lia"
}) {
  if (!smtpConfigured()) throw new Error("Email (SMTP) is not configured")
  const supabase = createServiceClient()
  const validUntil = pacificDatePlus(ESTIMATE_VALID_DAYS)
  await supabase.from("estimates").update({ valid_until: validUntil }).eq("id", opts.estimateId)

  const { buffer, est, number } = await buildEstimatePdf(opts.estimateId, { supabase, appUrl: opts.appUrl })
  const customer = est.customer
  const link = `${appBaseUrl(opts.appUrl)}/approve-estimate/${est.approval_token}`
  const def = defaultEstimateEmail(customer?.name ?? "", est.title)
  const subject = opts.subject?.trim() || def.subject
  const body = opts.body?.trim() || def.body
  const fileName = estimateFileName(number)

  const html = estimateEmailHtml({
    heading: `Your estimate${number ? ` ${number}` : ""}`,
    preheader: `${est.title} — ${formatMoney(Number(est.total))}. Valid until ${formatLongDate(validUntil)}.`,
    paragraphs: body.split(/\n{2,}/),
    facts: [["Project", est.title], ["Total", formatMoney(Number(est.total))], ["Valid until", formatLongDate(validUntil)]],
    ctaLabel: "Review & Sign Estimate",
    ctaUrl: link,
  })
  const text = `${body}\n\nReview and sign your estimate online:\n${link}\n\nThe estimate PDF is attached.\n\n${ESTIMATE_COMPANY.name} · ${ESTIMATE_COMPANY.phone} · ${ESTIMATE_COMPANY.email}`

  await createTransporter().sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: opts.to,
    subject,
    html,
    text,
    attachments: [{ filename: fileName, content: buffer, contentType: "application/pdf" }],
  })

  await storeEstimatePdf({ supabase, estimateId: est.id, customerId: est.customer_id, userId: opts.userId, buffer, fileName })
  const now = new Date().toISOString()
  await supabase.from("estimates").update({ status: "sent", sent_at: now }).eq("id", est.id).in("status", ["draft", "sent"])
  await supabase.from("communication_logs").insert({
    user_id: opts.userId, customer_id: est.customer_id, estimate_id: est.id, type: "estimate_follow_up",
    subject, body: `${body}\n\n[Sent${opts.via === "lia" ? " via Lia" : ""} with PDF ${fileName} and signing link]`, channel: "email",
  })
  await notifyLia({
    event_type: "estimate_sent", customer_name: customer?.name, customer_email: opts.to,
    document_name: `${number ? number + " · " : ""}${est.title}`, amount: Number(est.total),
    crm_url: `${appBaseUrl(opts.appUrl)}/estimates/${est.id}`,
  })
  return { number, validUntil, subject, link }
}
