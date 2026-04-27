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

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    sendNotificationEmail({ supabase, coId: co.id, action, now, req }).catch(() => {})
  }

  return Response.json({ success: true })
}

async function sendNotificationEmail({
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
    .select("id, title, amount, user_id, job_id, customer:customers(name), job:jobs(title)")
    .eq("id", coId)
    .single()

  if (!co) return

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const customerName = (co.customer as any)?.name ?? "Customer"
  const jobTitle = (co.job as any)?.title ?? "Job"
  const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(co.amount),
  )
  const actionDate = new Date(now).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const jobUrl = `${appUrl}/jobs/${co.job_id}`
  const isApprove = action === "approve"

  const subject = isApprove
    ? `Change Order Approved — ${customerName}`
    : `Change Order Declined — ${customerName}`

  const body = [
    `A change order has been ${isApprove ? "approved" : "declined"} online.`,
    ``,
    `Customer:  ${customerName}`,
    `Job:       ${jobTitle}`,
    `Change:    ${co.title}`,
    `Amount:    ${amount}`,
    `${isApprove ? "Approved" : "Declined"}:  ${actionDate}`,
    ``,
    `View job in CRM:`,
    jobUrl,
    ``,
    `— ${company?.company_name ?? "Omdan"}`,
  ].join("\n")

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
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
