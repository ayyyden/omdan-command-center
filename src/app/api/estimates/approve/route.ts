import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { notifyLia } from "@/lib/lia-notifications"

const NOTIFY_EMAIL = "omdandevelopment@gmail.com"

export async function POST(req: NextRequest) {
  const { token, action } = await req.json() as { token: string; action: "approve" | "decline" }

  if (!token || !action) {
    return Response.json({ error: "Missing fields" }, { status: 400 })
  }
  if (action !== "approve" && action !== "decline") {
    return Response.json({ error: "Invalid action" }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: estimate } = await supabase
    .from("estimates")
    .select("id, status")
    .eq("approval_token", token)
    .single()

  if (!estimate) {
    return Response.json({ error: "Estimate not found" }, { status: 404 })
  }

  if (estimate.status === "approved" || estimate.status === "rejected") {
    return Response.json({ error: "Already responded" }, { status: 409 })
  }

  const now = new Date().toISOString()
  const update =
    action === "approve"
      ? { status: "approved", approved_at: now }
      : { status: "rejected", declined_at: now }

  const { error: updateErr } = await supabase
    .from("estimates")
    .update(update)
    .eq("id", estimate.id)

  if (updateErr) {
    return Response.json({ error: "Could not update estimate" }, { status: 500 })
  }

  if (smtpConfigured()) {
    sendEmails({ supabase, estimateId: estimate.id, action, now, req }).catch(() => {})
  }

  void logAudit({
    documentType: "estimate",
    documentId:   estimate.id,
    tokenHash:    hashToken(token),
    action:       action === "approve" ? "approved" : "declined",
    ipAddress:    getIp(req.headers),
    userAgent:    getUa(req.headers),
  })

  // Lia notification (fire-and-forget)
  void (async () => {
    try {
      const { data: full } = await supabase
        .from("estimates")
        .select("id, title, total, customer:customers(name, email)")
        .eq("id", estimate.id)
        .single()
      if (!full) return
      const customer = full.customer as { name?: string; email?: string } | null
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
      notifyLia({
        event_type:    action === "approve" ? "estimate_approved" : "estimate_declined",
        customer_name: customer?.name,
        customer_email: customer?.email,
        document_name: full.title ?? undefined,
        amount:        Number(full.total),
        crm_url:       `${appUrl}/estimates/${full.id}`,
      })
    } catch { /* non-fatal */ }
  })()

  return Response.json({ success: true })
}

async function sendEmails({
  supabase,
  estimateId,
  action,
  now,
  req,
}: {
  supabase: ReturnType<typeof createServiceClient>
  estimateId: string
  action: "approve" | "decline"
  now: string
  req: NextRequest
}) {
  const { data: est } = await supabase
    .from("estimates")
    .select("id, title, total, user_id, customer:customers(name, email)")
    .eq("id", estimateId)
    .single()

  if (!est) return

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email, phone")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const customerName = (est.customer as any)?.name ?? "Customer"
  const customerEmail = (est.customer as any)?.email as string | null
  const companyName = company?.company_name ?? "Omdan"
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(est.total),
  )
  const actionDate = new Date(now).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const estimateUrl = `${appUrl}/estimates/${estimateId}`
  const isApprove = action === "approve"

  const transporter = createTransporter()

  // ── Notify business ──────────────────────────────────────────────────────────
  const bizSubject = isApprove
    ? `Estimate Approved — ${customerName}`
    : `Estimate Declined — ${customerName}`

  const bizHtml = buildHtmlEmail({
    title: isApprove ? "Estimate Approved" : "Estimate Declined",
    preheader: `${customerName} has ${isApprove ? "approved" : "declined"} an estimate.`,
    companyName,
    bodyLines: [
      `<strong>${customerName}</strong> has ${isApprove ? "approved" : "declined"} an estimate online.`,
      "",
      `<strong>Estimate:</strong> ${est.title}`,
      `<strong>Total:</strong> ${total}`,
      `<strong>${isApprove ? "Approved" : "Declined"}:</strong> ${actionDate}`,
    ],
    ctaLabel: "View Estimate",
    ctaUrl: estimateUrl,
  })

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to:      company?.email ?? NOTIFY_EMAIL,
    subject: bizSubject,
    text:    `${customerName} has ${isApprove ? "approved" : "declined"} estimate "${est.title}" (${total}).`,
    html:    bizHtml,
  })

  // ── Confirm to customer ──────────────────────────────────────────────────────
  if (customerEmail) {
    const custSubject = isApprove
      ? `Your estimate has been confirmed — ${est.title}`
      : `Estimate declined — ${est.title}`

    const custHtml = buildHtmlEmail({
      title: isApprove ? "Estimate Confirmed" : "Estimate Declined",
      preheader: isApprove
        ? "Thank you for approving your estimate."
        : "We received your response.",
      companyName,
      bodyLines: isApprove
        ? [
            `Hi ${customerName},`,
            "",
            `Thank you for approving your estimate. We'll be in touch shortly to schedule your project.`,
            "",
            `<strong>Estimate:</strong> ${est.title}`,
            `<strong>Total:</strong> ${total}`,
            `<strong>Approved:</strong> ${actionDate}`,
            "",
            company?.phone ? `Questions? Call us at ${company.phone}.` : "",
          ].filter((l) => l !== undefined)
        : [
            `Hi ${customerName},`,
            "",
            `We received your response declining estimate "${est.title}".`,
            "",
            `If you have any questions or would like to discuss changes, please don't hesitate to reach out.`,
            "",
            company?.phone ? `Call us at ${company.phone}.` : "",
          ].filter((l) => l !== undefined),
    })

    await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      customerEmail,
      subject: custSubject,
      text:    isApprove
        ? `Hi ${customerName}, thank you for approving your estimate "${est.title}" (${total}).`
        : `Hi ${customerName}, we received your response declining estimate "${est.title}".`,
      html:    custHtml,
    })
  }
}
