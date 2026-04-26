import { NextRequest } from "next/server"
import nodemailer from "nodemailer"
import { createServiceClient } from "@/lib/supabase/service"

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

  // Send notification email — best effort, does not affect response
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    sendNotificationEmail({ supabase, estimateId: estimate.id, action, now, req }).catch(() => {})
  }

  return Response.json({ success: true })
}

async function sendNotificationEmail({
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
    .select("id, title, total, user_id, customer:customers(name)")
    .eq("id", estimateId)
    .single()

  if (!est) return

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name")
    .eq("user_id", est.user_id)
    .single()

  const customerName = (est.customer as any)?.name ?? "Customer"
  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(est.total),
  )
  const actionDate = new Date(now).toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const estimateUrl = `${appUrl}/estimates/${estimateId}`
  const companyName = company?.company_name ?? "Omdan"

  const isApprove = action === "approve"
  const subject = isApprove
    ? `Estimate Approved — ${customerName}`
    : `Estimate Declined — ${customerName}`

  const body = isApprove
    ? [
        `An estimate has been approved online.`,
        ``,
        `Customer:  ${customerName}`,
        `Estimate:  ${est.title}`,
        `Total:     ${total}`,
        `Approved:  ${actionDate}`,
        ``,
        `View estimate in CRM:`,
        estimateUrl,
        ``,
        `— ${companyName}`,
      ].join("\n")
    : [
        `An estimate has been declined online.`,
        ``,
        `Customer:  ${customerName}`,
        `Estimate:  ${est.title}`,
        `Total:     ${total}`,
        `Declined:  ${actionDate}`,
        ``,
        `View estimate in CRM:`,
        estimateUrl,
        ``,
        `— ${companyName}`,
      ].join("\n")

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   ?? "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to:      NOTIFY_EMAIL,
    subject,
    text:    body,
  })
}
