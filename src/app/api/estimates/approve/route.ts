import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, smtpConfigured } from "@/lib/email"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { notifyLia } from "@/lib/lia-notifications"
import { buildEstimatePdf, storeEstimatePdf, estimateFileName, estimateEmailHtml, appBaseUrl } from "@/lib/estimate-delivery"
import { formatMoney, formatLongDate, ESTIMATE_COMPANY } from "@/lib/estimate-format"

export const maxDuration = 60

const NOTIFY_EMAIL = "omdandevelopment@gmail.com"
const MAX_SIGNATURE_BYTES = 600_000

// POST /api/estimates/approve { token, action: "approve"|"decline", signerName?, signature? }
// Public (the client's link). Approving needs the client's typed name and a
// drawn signature; it saves them, builds the SIGNED estimate PDF, stores it on
// the lead card, emails the client + Omdan, and tells Lia. All awaited — on
// Vercel anything left running after the response gets cut off.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { token?: string; action?: string; signerName?: string; signature?: string }
  const { token, action } = body
  if (!token || (action !== "approve" && action !== "decline")) return Response.json({ error: "Missing fields" }, { status: 400 })

  const supabase = createServiceClient()
  const { data: estimate } = await supabase.from("estimates").select("*").eq("approval_token", token).single()
  if (!estimate) return Response.json({ error: "Estimate not found" }, { status: 404 })
  if (estimate.status === "approved" || estimate.status === "rejected") return Response.json({ error: "Already responded" }, { status: 409 })

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  if (action === "approve" && estimate.valid_until && estimate.valid_until < today) {
    return Response.json({ error: `This estimate expired on ${formatLongDate(estimate.valid_until)}. Please contact us for an updated estimate.` }, { status: 410 })
  }

  const signerName = (body.signerName ?? "").trim().slice(0, 120)
  const signature = body.signature ?? ""
  if (action === "approve") {
    if (signerName.length < 2) return Response.json({ error: "Please type your full name." }, { status: 400 })
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > MAX_SIGNATURE_BYTES) {
      return Response.json({ error: "Please draw your signature." }, { status: 400 })
    }
  }

  const now = new Date().toISOString()
  const update: Record<string, unknown> = action === "approve"
    ? { status: "approved", approved_at: now, signer_name: signerName, signature_png: signature, signed_at: now }
    : { status: "rejected", declined_at: now }
  let { error: updateErr } = await supabase.from("estimates").update(update).eq("id", estimate.id).in("status", ["draft", "sent"])
  if (updateErr && /signer_name|signature_png|signed_at/.test(updateErr.message)) {
    // Before migration 066: record the approval without the signature columns
    ;({ error: updateErr } = await supabase.from("estimates").update({ status: "approved", approved_at: now }).eq("id", estimate.id))
  }
  if (updateErr) return Response.json({ error: "Could not update estimate" }, { status: 500 })

  await logAudit({
    documentType: "estimate", documentId: estimate.id, tokenHash: hashToken(token),
    action: action === "approve" ? "approved" : "declined",
    customerName: action === "approve" ? signerName : null,
    ipAddress: getIp(req.headers), userAgent: getUa(req.headers),
    metadata: action === "approve" ? { signed: true } : undefined,
  })

  const appUrl = appBaseUrl(req.nextUrl.origin)
  const { data: customer } = await supabase.from("customers").select("name, email").eq("id", estimate.customer_id).single()
  const customerName = customer?.name ?? signerName ?? "Customer"
  const total = formatMoney(Number(estimate.total))

  // Signed PDF → lead card
  let signedPdf: { buffer: Buffer; fileName: string } | null = null
  if (action === "approve") {
    try {
      const { buffer, number } = await buildEstimatePdf(estimate.id, { supabase, appUrl })
      const fileName = estimateFileName(number, true)
      await storeEstimatePdf({ supabase, estimateId: estimate.id, customerId: estimate.customer_id, userId: estimate.user_id, buffer, fileName, signed: true })
      signedPdf = { buffer, fileName }
    } catch (err) {
      console.error("[estimates/approve] signed PDF failed:", err)
    }
  }

  if (smtpConfigured()) {
    try {
      await sendEmails({ estimate, action, customerName, customerEmail: customer?.email ?? null, signerName, total, now, appUrl, signedPdf })
    } catch (err) {
      console.error("[estimates/approve] emails failed:", err)
    }
  }

  await notifyLia({
    event_type: action === "approve" ? "estimate_approved" : "estimate_declined",
    customer_name: customerName, customer_email: customer?.email ?? undefined,
    document_name: estimate.title ?? undefined, amount: Number(estimate.total),
    crm_url: `${appUrl}/estimates/${estimate.id}`,
    extra: action === "approve" ? `Signed online by ${signerName}` : undefined,
  })

  return Response.json({ success: true })
}

async function sendEmails(o: {
  estimate: { id: string; title: string; estimate_number?: number | null }
  action: "approve" | "decline"; customerName: string; customerEmail: string | null; signerName: string
  total: string; now: string; appUrl: string; signedPdf: { buffer: Buffer; fileName: string } | null
}) {
  const transporter = createTransporter()
  const from = process.env.SMTP_FROM ?? process.env.SMTP_USER
  const approve = o.action === "approve"
  const when = new Date(o.now).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" })
  const number = o.estimate.estimate_number ? `E-${o.estimate.estimate_number}` : null
  const attachments = o.signedPdf ? [{ filename: o.signedPdf.fileName, content: o.signedPdf.buffer, contentType: "application/pdf" }] : []

  // Omdan
  await transporter.sendMail({
    from, to: NOTIFY_EMAIL,
    subject: `${approve ? "Estimate signed" : "Estimate declined"} — ${o.customerName}${number ? ` (${number})` : ""}`,
    text: `${o.customerName} ${approve ? `signed and approved` : "declined"} "${o.estimate.title}" (${o.total}) on ${when}.`,
    html: estimateEmailHtml({
      heading: approve ? "Estimate signed & approved" : "Estimate declined",
      paragraphs: [approve ? `${o.customerName} signed and approved the estimate online.` : `${o.customerName} declined the estimate online.`],
      facts: [["Estimate", `${number ? number + " · " : ""}${o.estimate.title}`], ["Total", o.total], [approve ? "Signed" : "Declined", when], ...(approve ? [["Signed by", o.signerName] as [string, string]] : [])],
      ctaLabel: "Open in the CRM", ctaUrl: `${o.appUrl}/estimates/${o.estimate.id}`,
    }),
    attachments,
  })

  // The client
  if (!o.customerEmail) return
  const first = o.customerName.split(/\s+/)[0]
  await transporter.sendMail({
    from, to: o.customerEmail,
    subject: approve ? `Your signed estimate — ${o.estimate.title}` : `Estimate declined — ${o.estimate.title}`,
    text: approve
      ? `Hi ${first}, thank you for approving your estimate "${o.estimate.title}" (${o.total}). Your signed copy is attached. We'll be in touch shortly to schedule your project. ${ESTIMATE_COMPANY.phone}`
      : `Hi ${first}, we received your response declining "${o.estimate.title}". If you'd like to discuss changes, call us at ${ESTIMATE_COMPANY.phone}.`,
    html: estimateEmailHtml({
      heading: approve ? "Thank you — your estimate is signed" : "We received your response",
      paragraphs: approve
        ? [`Hi ${first},`, "Thank you for approving your estimate. Your signed copy is attached to this email. We'll be in touch shortly to schedule your project.", `Questions? Call us at ${ESTIMATE_COMPANY.phone}.`]
        : [`Hi ${first},`, `We received your response declining the estimate for ${o.estimate.title.toLowerCase()}.`, `If you'd like to discuss changes, call us at ${ESTIMATE_COMPANY.phone} — we're happy to help.`],
      facts: approve ? [["Estimate", `${number ? number + " · " : ""}${o.estimate.title}`], ["Total", o.total], ["Signed", when]] : undefined,
    }),
    attachments,
  })
}
