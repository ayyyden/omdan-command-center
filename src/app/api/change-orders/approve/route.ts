import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"

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

  const { data: co } = await supabase
    .from("change_orders")
    .select("id, status")
    .eq("approval_token", token)
    .single()

  if (!co) return Response.json({ error: "Change order not found" }, { status: 404 })

  if (co.status === "approved" || co.status === "rejected") {
    return Response.json({ error: "Already responded" }, { status: 409 })
  }

  const now = new Date().toISOString()
  const update =
    action === "approve"
      ? { status: "approved", approved_at: now }
      : { status: "rejected", rejected_at: now }

  const { error: updateErr } = await supabase
    .from("change_orders")
    .update(update)
    .eq("id", co.id)

  if (updateErr) return Response.json({ error: "Could not update change order" }, { status: 500 })

  if (smtpConfigured()) {
    sendEmails({ supabase, coId: co.id, action, now, req }).catch(() => {})
  }

  void logAudit({
    documentType: "change_order",
    documentId:   co.id,
    tokenHash:    hashToken(token),
    action:       action === "approve" ? "approved" : "declined",
    ipAddress:    getIp(req.headers),
    userAgent:    getUa(req.headers),
  })

  return Response.json({ success: true })
}

async function sendEmails({
  supabase,
  coId,
  action,
  now,
  req,
}: {
  supabase: ReturnType<typeof createServiceClient>
  coId: string
  action: "approve" | "decline"
  now: string
  req: NextRequest
}) {
  const { data: co } = await supabase
    .from("change_orders")
    .select("id, title, amount, user_id, job_id, customer:customers(name, email), job:jobs(title)")
    .eq("id", coId)
    .single()

  if (!co) return

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email, phone")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const customerName = (co.customer as any)?.name ?? "Customer"
  const customerEmail = (co.customer as any)?.email as string | null
  const jobTitle = (co.job as any)?.title ?? "your project"
  const companyName = company?.company_name ?? "Omdan"
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(co.amount),
  )
  const actionDate = new Date(now).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const jobUrl = `${appUrl}/jobs/${co.job_id}`
  const isApprove = action === "approve"

  const transporter = createTransporter()

  // ── Notify business ──────────────────────────────────────────────────────────
  const bizSubject = isApprove
    ? `Change Order Approved — ${customerName}`
    : `Change Order Declined — ${customerName}`

  const bizHtml = buildHtmlEmail({
    title: isApprove ? "Change Order Approved" : "Change Order Declined",
    preheader: `${customerName} has ${isApprove ? "approved" : "declined"} a change order.`,
    companyName,
    bodyLines: [
      `<strong>${customerName}</strong> has ${isApprove ? "approved" : "declined"} a change order online.`,
      "",
      `<strong>Job:</strong> ${jobTitle}`,
      `<strong>Change:</strong> ${co.title}`,
      `<strong>Amount:</strong> ${amount}`,
      `<strong>${isApprove ? "Approved" : "Declined"}:</strong> ${actionDate}`,
    ],
    ctaLabel: "View Job",
    ctaUrl: jobUrl,
  })

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to:      company?.email ?? NOTIFY_EMAIL,
    subject: bizSubject,
    text:    `${customerName} has ${isApprove ? "approved" : "declined"} change order "${co.title}" (${amount}).`,
    html:    bizHtml,
  })

  // ── Confirm to customer ──────────────────────────────────────────────────────
  if (customerEmail) {
    const custSubject = isApprove
      ? `Change order approved — ${co.title}`
      : `Change order declined — ${co.title}`

    const custHtml = buildHtmlEmail({
      title: isApprove ? "Change Order Approved" : "Change Order Declined",
      preheader: isApprove
        ? "Thank you for approving the change order."
        : "We received your response.",
      companyName,
      bodyLines: isApprove
        ? [
            `Hi ${customerName},`,
            "",
            `Thank you for approving the change order for ${jobTitle}.`,
            "",
            `<strong>Change:</strong> ${co.title}`,
            `<strong>Amount:</strong> ${amount}`,
            `<strong>Approved:</strong> ${actionDate}`,
            "",
            company?.phone ? `Questions? Call us at ${company.phone}.` : "",
          ].filter((l) => l !== undefined)
        : [
            `Hi ${customerName},`,
            "",
            `We received your response declining the change order "${co.title}" for ${jobTitle}.`,
            "",
            `If you have any questions, please don't hesitate to reach out.`,
            "",
            company?.phone ? `Call us at ${company.phone}.` : "",
          ].filter((l) => l !== undefined),
    })

    await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      customerEmail,
      subject: custSubject,
      text:    isApprove
        ? `Hi ${customerName}, thank you for approving the change order "${co.title}" (${amount}).`
        : `Hi ${customerName}, we received your response declining change order "${co.title}".`,
      html:    custHtml,
    })
  }
}
