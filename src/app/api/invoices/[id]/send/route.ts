import { NextRequest } from "next/server"
import { requirePermission, hasJobScope } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"

const METHOD_LABELS: Record<string, string> = {
  zelle:  "Zelle",
  cash:   "Cash",
  check:  "Check",
  venmo:  "Venmo",
}

function methodLabel(v: string) {
  return METHOD_LABELS[v] ?? v.charAt(0).toUpperCase() + v.slice(1)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await requirePermission("jobs:view")
  if (session instanceof Response) return session
  const { userId, role, pmId, supabase } = session

  const { to, subject, body } = await req.json() as { to: string; subject: string; body: string }

  if (!to) return Response.json({ error: "Recipient email required" }, { status: 400 })

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, customer:customers(name, email), job:jobs(id, title, project_manager_id)")
    .eq("id", id)
    .single()

  if (!inv) return Response.json({ error: "Invoice not found" }, { status: 404 })

  if (hasJobScope(role)) {
    const pmIdOnJob = (inv.job as any)?.project_manager_id
    if (pmIdOnJob !== pmId) return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, address, logo_url, license_number")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const customerName = (inv.customer as any)?.name ?? "Customer"
  const jobTitle     = (inv.job as any)?.title ?? ""
  const companyName  = company?.company_name ?? "Omdan"
  const BUILT_IN: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final" }
  const typeLabel = BUILT_IN[inv.type]
    ?? String(inv.type).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const fmtAmount    = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(inv.amount))
  const methods      = (inv.payment_methods ?? []) as string[]
  const methodsLine  = methods.length > 0
    ? methods.map(methodLabel).join(", ")
    : "Contact us to arrange payment"

  const bodyLines: string[] = [
    `Hi ${customerName},`,
    "",
    body || `Please find your invoice details below.`,
    "",
  ]

  if (inv.invoice_number) {
    bodyLines.push(`<strong>Invoice #:</strong> ${inv.invoice_number}`)
  }
  if (jobTitle) {
    bodyLines.push(`<strong>Job:</strong> ${jobTitle}`)
  }
  bodyLines.push(
    `<strong>Type:</strong> ${typeLabel}`,
    `<strong>Amount Due:</strong> ${fmtAmount}`,
  )
  if (inv.due_date) {
    const due = new Date(inv.due_date + "T00:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    })
    bodyLines.push(`<strong>Due Date:</strong> ${due}`)
  }
  if (inv.notes) {
    bodyLines.push("", inv.notes)
  }
  bodyLines.push(
    "",
    `<strong>Payment Methods Accepted:</strong> ${methodsLine}`,
  )
  if (company?.phone) {
    bodyLines.push("", `Questions? Call us at ${company.phone}.`)
  }

  const html = buildHtmlEmail({
    title: `${typeLabel} Invoice${inv.invoice_number ? ` — ${inv.invoice_number}` : ""}`,
    preheader: `You have a ${typeLabel.toLowerCase()} invoice for ${fmtAmount}.`,
    companyName,
    bodyLines,
  })

  const plainText = [
    `Hi ${customerName},`,
    "",
    body || `Please find your invoice details below.`,
    "",
    inv.invoice_number ? `Invoice #: ${inv.invoice_number}` : "",
    jobTitle ? `Job: ${jobTitle}` : "",
    `Type: ${typeLabel}`,
    `Amount Due: ${fmtAmount}`,
    inv.due_date ? `Due Date: ${inv.due_date}` : "",
    inv.notes ? `\n${inv.notes}` : "",
    "",
    `Payment Methods Accepted: ${methodsLine}`,
    company?.phone ? `\nQuestions? Call us at ${company.phone}.` : "",
  ].filter(Boolean).join("\n")

  const transporter = createTransporter()
  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: subject || `Invoice from ${companyName}${inv.invoice_number ? ` — ${inv.invoice_number}` : ""}`,
    text:    plainText,
    html,
  })

  await supabase
    .from("invoices")
    .update({ status: "sent" })
    .eq("id", id)
    .eq("status", "draft")

  await supabase.from("communication_logs").insert({
    user_id:     userId,
    customer_id: inv.customer_id,
    job_id:      inv.job_id,
    type:        "custom",
    subject:     subject || `Invoice — ${fmtAmount}`,
    body:        plainText,
    channel:     "email",
  })

  return Response.json({ success: true })
}
