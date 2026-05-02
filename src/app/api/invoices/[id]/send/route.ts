import { NextRequest } from "next/server"
import { requirePermission, hasJobScope } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { notifyLia } from "@/lib/lia-notifications"
import { generateInvoicePDFBuffer } from "@/lib/pdf/generate-invoice-pdf"

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
    .select("*, customer:customers(name, email, phone, address), job:jobs(id, title, project_manager_id)")
    .eq("id", id)
    .single()

  if (!inv) return Response.json({ error: "Invoice not found" }, { status: 404 })

  if (hasJobScope(role)) {
    const pmIdOnJob = (inv.job as { project_manager_id: string | null } | null)?.project_manager_id
    if (pmIdOnJob !== pmId) return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const customer     = inv.customer as { name: string; email: string | null; phone: string | null; address: string | null } | null
  const job          = inv.job      as { id: string; title: string }                                                        | null
  const customerName = customer?.name ?? "Customer"
  const jobTitle     = job?.title     ?? ""
  const companyName  = "" // resolved after company fetch below

  const BUILT_IN: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final" }
  const typeLabel = BUILT_IN[inv.type as string]
    ?? String(inv.type).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  const fmtAmount   = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(inv.amount))
  const methods     = (inv.payment_methods ?? []) as string[]
  const methodsLine = methods.length > 0
    ? methods.map(methodLabel).join(", ")
    : "Contact us to arrange payment"

  // ── Generate invoice PDF (best-effort — errors are logged, email still sends) ─
  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generateInvoicePDFBuffer({
      invoice: {
        id:              inv.id as string,
        invoice_number:  (inv.invoice_number as string | null) ?? null,
        created_at:      inv.created_at as string,
        type:            inv.type as string,
        type_label:      typeLabel,
        amount:          Number(inv.amount),
        due_date:        (inv.due_date as string | null) ?? null,
        notes:           (inv.notes as string | null)    ?? null,
        payment_methods: methods,
      },
      customer: {
        name:    customerName,
        email:   customer?.email   ?? null,
        phone:   customer?.phone   ?? null,
        address: customer?.address ?? null,
      },
      job: job ? { title: jobTitle } : null,
      ownerUserId: inv.user_id as string,
    })
  } catch (err) {
    console.error("[invoices/send] PDF generation failed:", err)
  }

  // ── Fetch company settings (needed for email footer + resolved company name) ─
  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, address, logo_url, license_number")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const resolvedCompanyName = company?.company_name ?? "Omdan"

  // ── Build email ───────────────────────────────────────────────────────────
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
    const due = new Date((inv.due_date as string) + "T00:00:00").toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric",
    })
    bodyLines.push(`<strong>Due Date:</strong> ${due}`)
  }
  if (inv.notes) {
    bodyLines.push("", inv.notes as string)
  }
  bodyLines.push(
    "",
    `<strong>Payment Methods Accepted:</strong> ${methodsLine}`,
  )
  if (company?.phone) {
    bodyLines.push("", `Questions? Call us at ${company.phone}.`)
  }
  if (pdfBuffer) {
    bodyLines.push("", "Your invoice PDF is attached to this email for your records.")
  }

  const html = buildHtmlEmail({
    title:     `${typeLabel} Invoice${inv.invoice_number ? ` — ${inv.invoice_number}` : ""}`,
    preheader: `You have a ${typeLabel.toLowerCase()} invoice for ${fmtAmount}.`,
    companyName: resolvedCompanyName,
    bodyLines,
  })

  const plainText = [
    `Hi ${customerName},`,
    "",
    body || `Please find your invoice details below.`,
    "",
    inv.invoice_number ? `Invoice #: ${inv.invoice_number}` : "",
    jobTitle            ? `Job: ${jobTitle}`                 : "",
    `Type: ${typeLabel}`,
    `Amount Due: ${fmtAmount}`,
    inv.due_date        ? `Due Date: ${inv.due_date}`        : "",
    inv.notes           ? `\n${inv.notes}`                   : "",
    "",
    `Payment Methods Accepted: ${methodsLine}`,
    company?.phone      ? `\nQuestions? Call us at ${company.phone}.` : "",
  ].filter(Boolean).join("\n")

  const emailSubject = subject || `Invoice from ${resolvedCompanyName}${inv.invoice_number ? ` — ${inv.invoice_number}` : ""}`
  const pdfFilename  = `Invoice-${(inv.invoice_number as string | null) ?? (inv.id as string).slice(0, 8)}.pdf`

  const transporter = createTransporter()
  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject: emailSubject,
    text:    plainText,
    html,
    attachments: pdfBuffer
      ? [{ filename: pdfFilename, content: pdfBuffer, contentType: "application/pdf" }]
      : [],
  })

  // ── Upload PDF to Supabase Storage (best-effort) ──────────────────────────
  if (pdfBuffer) {
    try {
      const storagePath = `invoices/${id}.pdf`
      const { error: uploadErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true })
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from("documents").getPublicUrl(storagePath)
        await supabase.from("invoices").update({ pdf_url: urlData.publicUrl }).eq("id", id)
      }
    } catch { /* non-critical */ }
  }

  notifyLia({
    event_type:     "invoice_sent",
    customer_name:  customerName,
    customer_email: to,
    document_name:  inv.invoice_number ? `Invoice #${inv.invoice_number}` : `${typeLabel} Invoice`,
    amount:         Number(inv.amount),
    crm_url:        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/invoices/${id}`,
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
    subject:     emailSubject,
    body:        plainText,
    channel:     "email",
  })

  return Response.json({ success: true })
}
