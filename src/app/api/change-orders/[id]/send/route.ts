import { NextRequest } from "next/server"
import nodemailer from "nodemailer"
import { createClient } from "@/lib/supabase/server"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const { to, subject, body } = await req.json() as { to: string; subject: string; body: string }

  if (!to || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { data: co } = await supabase
    .from("change_orders")
    .select("*, customer:customers(id, name, email)")
    .eq("id", id)
    .single()

  if (!co) return Response.json({ error: "Not found" }, { status: 404 })

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Response.json({ error: "SMTP not configured" }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const approvalLink = `${appUrl}/approve-change-order/${co.approval_token}`

  const emailBody = `${body}

---
Review and approve this change order online:
${approvalLink}`

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text:    emailBody,
  })

  const now = new Date().toISOString()
  await supabase
    .from("change_orders")
    .update({ status: "sent", sent_at: now })
    .eq("id", id)
    .eq("status", "draft")

  const customer = co.customer as { id: string; name: string; email: string | null }
  await supabase.from("communication_logs").insert({
    user_id:     user.id,
    customer_id: customer.id,
    job_id:      co.job_id,
    type:        "change_order",
    subject,
    body:        emailBody,
    channel:     "email",
  })

  return Response.json({ success: true })
}
