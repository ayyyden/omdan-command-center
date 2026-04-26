import { NextRequest } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import nodemailer from "nodemailer"
import React from "react"
import { createClient } from "@/lib/supabase/server"
import { EstimatePDFDocument } from "@/lib/pdf/estimate-document"
import type { EstimateLineItem } from "@/types"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const { to, subject, body } = await req.json() as {
    to: string
    subject: string
    body: string
  }

  if (!to || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Fetch estimate + customer
  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("*, customer:customers(id, name, address, phone, email)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (estErr || !estimate) return Response.json({ error: "Not found" }, { status: 404 })

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, license_number, logo_url, address")
    .eq("user_id", user.id)
    .single()

  const customer = estimate.customer as { id: string; name: string; address: string | null; phone: string | null; email: string | null }

  // Generate PDF
  const doc = React.createElement(EstimatePDFDocument, {
    estimate: {
      id:             estimate.id,
      title:          estimate.title,
      created_at:     estimate.created_at,
      scope_of_work:  estimate.scope_of_work,
      line_items:     (estimate.line_items ?? []) as EstimateLineItem[],
      subtotal:       Number(estimate.subtotal),
      markup_percent: Number(estimate.markup_percent),
      markup_amount:  Number(estimate.markup_amount),
      tax_percent:    Number(estimate.tax_percent),
      tax_amount:     Number(estimate.tax_amount),
      total:          Number(estimate.total),
      notes:          estimate.notes,
    },
    customer: {
      name:    customer?.name    ?? "",
      address: customer?.address ?? null,
      phone:   customer?.phone   ?? null,
      email:   customer?.email   ?? null,
    },
    company: {
      company_name:   company?.company_name   ?? null,
      phone:          company?.phone          ?? null,
      email:          company?.email          ?? null,
      license_number: company?.license_number ?? null,
      logo_url:       company?.logo_url       ?? null,
      address:        company?.address        ?? null,
    },
  })

  const pdfBuffer = await renderToBuffer(doc as React.ReactElement<any>)

  // Send email via SMTP
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const approvalLink = `${appUrl}/approve-estimate/${estimate.approval_token}`

  const emailBody = `${body}

---
Click the link below to review and approve your estimate online:
${approvalLink}

The estimate PDF is also attached to this email for your reference.`

  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text:    emailBody,
    attachments: [
      {
        filename:    `estimate-${estimate.id.slice(0, 8)}.pdf`,
        content:     pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  })

  // Also store PDF in Supabase Storage
  const path = `estimates/${id}.pdf`
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(path, pdfBuffer, { contentType: "application/pdf", upsert: true })

  if (!uploadError) {
    const { data: urlData } = supabase.storage.from("documents").getPublicUrl(path)
    await supabase.from("estimates").update({ pdf_url: urlData.publicUrl }).eq("id", id)
  }

  // Update estimate status → sent
  const now = new Date().toISOString()
  await supabase
    .from("estimates")
    .update({ status: "sent", sent_at: now })
    .eq("id", id)
    .eq("status", "draft") // only auto-advance from draft

  // Log communication
  await supabase.from("communication_logs").insert({
    user_id:     user.id,
    customer_id: customer.id,
    estimate_id: id,
    type:        "estimate_follow_up",
    subject,
    body:        emailBody,
    channel:     "email",
  })

  return Response.json({ success: true })
}
