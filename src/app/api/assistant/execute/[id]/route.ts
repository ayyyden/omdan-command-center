import { NextResponse } from "next/server"
import nodemailer from "nodemailer"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { generateEstimateScope } from "@/lib/scope-generator"
import { generateEstimatePDFBuffer } from "@/lib/pdf/generate-estimate-pdf"
import { notifyLia } from "@/lib/lia-notifications"

interface RouteCtx { params: Promise<{ id: string }> }

// ─── POST /api/assistant/execute/[id] ────────────────────────────────────────
// Executes an approved assistant action. Called by the bridge after the user
// approves the preview. The approval must already be in "approved" status.

export async function POST(_req: Request, { params }: RouteCtx) {
  const err = verifyAssistantSecret(_req)
  if (err) return err

  const { id } = await params
  const supabase = createServiceClient()

  // Fetch the approval
  const { data: approval, error: fetchErr } = await supabase
    .from("assistant_approvals")
    .select("*")
    .eq("id", id)
    .single()

  if (fetchErr || !approval) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 })
  }
  if (approval.status !== "approved") {
    return NextResponse.json({ error: `Approval status is "${approval.status}", expected "approved"` }, { status: 400 })
  }
  if (new Date(approval.expires_at) < new Date()) {
    return NextResponse.json({ error: "Approval has expired" }, { status: 400 })
  }

  // Resolve owner user_id for record creation.
  // Priority: ASSISTANT_OWNER_EMAIL env var → role=owner/admin fallback.
  let ownerUserId: string | null = null

  const ownerEmail = process.env.ASSISTANT_OWNER_EMAIL
  if (ownerEmail) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("team_members")
      .select("user_id, role")
      .ilike("email", ownerEmail)
      .not("user_id", "is", null)
      .single()
    if (emailErr) {
      console.error("[execute] owner lookup by ASSISTANT_OWNER_EMAIL failed:", emailErr.message)
    }
    if (byEmail?.user_id && ["owner", "admin"].includes(byEmail.role)) {
      ownerUserId = byEmail.user_id as string
    } else if (byEmail?.user_id) {
      console.error("[execute] ASSISTANT_OWNER_EMAIL maps to role:", byEmail.role, "— must be owner or admin")
      return NextResponse.json({ error: "Configured ASSISTANT_OWNER_EMAIL is not an owner or admin" }, { status: 500 })
    }
  }

  if (!ownerUserId) {
    const { data: byRole, error: roleErr } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("role", "owner")
      .eq("status", "active")
      .not("user_id", "is", null)
      .single()
    if (roleErr) {
      console.error("[execute] owner fallback lookup failed:", roleErr.message, roleErr.details)
    }
    ownerUserId = (byRole?.user_id as string) ?? null
  }

  if (!ownerUserId) {
    return NextResponse.json({
      error: "Owner not found. Set ASSISTANT_OWNER_EMAIL in Vercel env vars to the owner's email address.",
    }, { status: 500 })
  }

  const payload = approval.proposed_payload as Record<string, unknown>
  const now = new Date().toISOString()
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app"

  // ─── create_lead_estimate ─────────────────────────────────────────────────

  if (approval.action_type === "create_lead_estimate") {
    const lead = payload.lead as Record<string, string | undefined>
    const estData = payload.estimate as {
      services?: string; total?: number; scope_override?: string
      payment_steps?: Array<{ name: string; amount: number }>
    } | null

    // Create customer
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .insert({
        name:         lead.name ?? "Unknown",
        phone:        lead.phone  ?? null,
        email:        lead.email  ?? null,
        service_type: lead.service_type ?? null,
        status:       "New Lead",
        user_id:      ownerUserId,
      })
      .select()
      .single()

    if (custErr || !customer) {
      await supabase.from("assistant_approvals")
        .update({ status: "failed", error: custErr?.message, updated_at: now }).eq("id", id)
      return NextResponse.json({ error: `Failed to create customer: ${custErr?.message}` }, { status: 500 })
    }

    // Mark this approval as executed
    await supabase.from("assistant_approvals")
      .update({ status: "executed", executed_at: now, result: { customer_id: customer.id }, updated_at: now })
      .eq("id", id)

    // No estimate requested
    if (!estData || !estData.total) {
      return NextResponse.json({
        action_type:      "create_lead_estimate",
        customer_id:      customer.id,
        estimate_id:      null,
        send_approval_id: null,
        message: `Lead created for ${lead.name}.`,
      })
    }

    // Generate professional scope of work + title using Claude
    const { title: generatedTitle, scope: generatedScope } = await generateEstimateScope(
      estData.services ?? lead.service_type ?? "Project",
      estData.scope_override,
    )

    const total         = Number(estData.total)
    const approvalToken = crypto.randomUUID()

    const { data: estimate, error: estErr } = await supabase
      .from("estimates")
      .insert({
        customer_id:        customer.id,
        user_id:            ownerUserId,
        title:              generatedTitle,
        scope_of_work:      generatedScope || null,
        manual_total_price: total,
        line_items:         [],
        markup_percent:     0,
        tax_percent:        0,
        subtotal:           total,
        markup_amount:      0,
        tax_amount:         0,
        total:              total,
        status:             "draft",
        approval_token:     approvalToken,
      })
      .select()
      .single()

    if (estErr || !estimate) {
      return NextResponse.json({ error: `Lead created but estimate failed: ${estErr?.message}` }, { status: 500 })
    }

    // Insert payment steps
    if (estData.payment_steps?.length) {
      await supabase.from("estimate_payment_steps").insert(
        estData.payment_steps.map((s, i) => ({
          estimate_id: estimate.id,
          name:        s.name,
          amount:      s.amount,
          sort_order:  i,
        }))
      )
    }

    // Create approval for the send step — include scope so PDF can be generated later
    const estimateUrl   = `${appUrl}/estimates/${estimate.id}`
    const { data: sendApproval } = await supabase
      .from("assistant_approvals")
      .insert({
        channel:               approval.channel,
        action_type:           "send_estimate",
        action_summary:        `Send $${total.toLocaleString()} estimate to ${lead.email ?? lead.name}`,
        proposed_payload: {
          estimate_id:    estimate.id,
          customer_id:    customer.id,
          to_email:       lead.email ?? null,
          customer_name:  lead.name,
          estimate_title: generatedTitle,
          total,
          services:       estData.services,
          scope:          generatedScope,
          payment_steps:  estData.payment_steps ?? [],
          estimate_url:   estimateUrl,
        },
        requested_by_whatsapp: approval.requested_by_whatsapp ?? null,
        requested_by_external: approval.requested_by_external ?? null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    // Scope summary: first 200 chars for Telegram preview
    const scopeSummary = generatedScope
      ? generatedScope.slice(0, 200).replace(/\n/g, " ").trimEnd() + (generatedScope.length > 200 ? "…" : "")
      : null

    return NextResponse.json({
      action_type:      "create_lead_estimate",
      customer_id:      customer.id,
      estimate_id:      estimate.id,
      send_approval_id: sendApproval?.id ?? null,
      estimate_preview: {
        title:         generatedTitle,
        customer_name: lead.name as string,
        email:         lead.email ?? null,
        services:      estData.services ?? null,
        scope:         scopeSummary,
        total,
        payment_steps: estData.payment_steps ?? [],
        estimate_url:  estimateUrl,
      },
    })
  }

  // ─── send_estimate ────────────────────────────────────────────────────────

  if (approval.action_type === "send_estimate") {
    const {
      estimate_id, customer_id, to_email, customer_name,
      estimate_title, total, services, scope, payment_steps, estimate_url,
    } = payload as {
      estimate_id: string; customer_id: string; to_email: string | null
      customer_name: string; estimate_title: string; total: number
      services: string | null; scope: string | null
      payment_steps: Array<{ name: string; amount: number }>
      estimate_url: string
    }

    if (!to_email) {
      await supabase.from("assistant_approvals")
        .update({ status: "failed", error: "No recipient email", updated_at: now }).eq("id", id)
      return NextResponse.json({ error: "No email address on file for this customer" }, { status: 400 })
    }

    if (!smtpConfigured()) {
      await supabase.from("assistant_approvals")
        .update({ status: "failed", error: "SMTP not configured", updated_at: now }).eq("id", id)
      return NextResponse.json({ error: "SMTP not configured" }, { status: 500 })
    }

    // Fetch company name and approval token
    const [{ data: company }, { data: est }, { data: customerRow }] = await Promise.all([
      supabase.from("company_settings")
        .select("company_name, email, phone")
        .eq("user_id", ownerUserId)
        .maybeSingle(),
      supabase.from("estimates")
        .select("approval_token, scope_of_work, created_at")
        .eq("id", estimate_id)
        .single(),
      supabase.from("customers")
        .select("name, phone, email, address")
        .eq("id", customer_id)
        .single(),
    ])

    const companyName   = company?.company_name ?? "Omdan"
    const approvalToken = est?.approval_token
    const approvalLink  = approvalToken
      ? `${appUrl}/approve-estimate/${approvalToken}`
      : estimate_url
    const scopeOfWork   = est?.scope_of_work ?? scope ?? null

    // Generate PDF with scope + payment schedule + approval link
    let pdfBuffer: Buffer | null = null
    try {
      pdfBuffer = await generateEstimatePDFBuffer({
        estimate: {
          id:            estimate_id,
          title:         estimate_title,
          created_at:    est?.created_at ?? now,
          scope_of_work: scopeOfWork,
          total:         Number(total),
          payment_steps: (payment_steps ?? []).map((s, i) => ({ ...s, sort_order: i })),
          approval_link: approvalLink,
        },
        customer: {
          name:    customerRow?.name    ?? customer_name,
          phone:   customerRow?.phone   ?? null,
          email:   customerRow?.email   ?? to_email,
          address: customerRow?.address ?? null,
        },
        ownerUserId,
      })
    } catch (pdfErr) {
      console.error("[execute/send_estimate] PDF generation failed:", pdfErr)
    }

    // Build HTML email
    const paymentLines = (payment_steps ?? []).map(
      (s) => `${s.name}: $${Number(s.amount).toLocaleString()}`
    )

    const bodyLines: string[] = [
      `Hi ${customer_name},`,
      "",
      `${companyName} has prepared an estimate for your project.`,
      "",
      `<strong>Project:</strong> ${services ?? estimate_title}`,
      `<strong>Total: $${Number(total).toLocaleString()}</strong>`,
    ]

    if (paymentLines.length) {
      bodyLines.push("", "<strong>Payment Schedule:</strong>")
      paymentLines.forEach((l) => bodyLines.push(`&nbsp;&nbsp;• ${l}`))
    }

    bodyLines.push(
      "",
      pdfBuffer
        ? "A PDF copy of your estimate is attached. Please review and approve using the button below."
        : "Please review and approve your estimate using the button below.",
    )

    const html = buildHtmlEmail({
      title:       `Your Estimate from ${companyName}`,
      preheader:   `$${Number(total).toLocaleString()} estimate ready for your review`,
      companyName,
      bodyLines,
      ctaLabel:    "Review & Approve Estimate",
      ctaUrl:      approvalLink,
    })

    // Send email with PDF attachment
    const transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
      port:   Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth:   { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    })

    await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      to_email,
      subject: `Your Estimate from ${companyName}`,
      html,
      attachments: pdfBuffer
        ? [{ filename: `estimate-${estimate_id.slice(0, 8)}.pdf`, content: pdfBuffer, contentType: "application/pdf" }]
        : [],
    })

    // Upload PDF to storage (best-effort)
    if (pdfBuffer) {
      try {
        const storagePath = `estimates/${estimate_id}.pdf`
        const { error: uploadErr } = await supabase.storage
          .from("documents")
          .upload(storagePath, pdfBuffer, { contentType: "application/pdf", upsert: true })
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from("documents").getPublicUrl(storagePath)
          await supabase.from("estimates").update({ pdf_url: urlData.publicUrl }).eq("id", estimate_id)
        }
      } catch { /* non-critical */ }
    }

    // Update estimate → sent
    await supabase.from("estimates")
      .update({ status: "sent", sent_at: now })
      .eq("id", estimate_id)
      .eq("status", "draft")

    // Log communication (best-effort)
    try {
      await supabase.from("communication_logs").insert({
        user_id:     ownerUserId,
        customer_id,
        estimate_id,
        type:        "estimate_follow_up",
        subject:     `Your Estimate from ${companyName}`,
        body:        `Estimate sent via Lia assistant to ${to_email}${pdfBuffer ? " (with PDF)" : ""}`,
        channel:     "email",
      })
    } catch { /* non-critical */ }

    // Mark approval as executed
    await supabase.from("assistant_approvals")
      .update({ status: "executed", executed_at: now, result: { sent_to: to_email }, updated_at: now })
      .eq("id", id)

    return NextResponse.json({
      action_type: "send_estimate",
      success:     true,
      sent_to:     to_email,
      pdf_attached: !!pdfBuffer,
    })
  }

  // ─── create_send_invoice ─────────────────────────────────────────────────

  if (approval.action_type === "create_send_invoice") {
    const {
      customer_id, customer_name, customer_email,
      job_id, amount, type, notes, due_date, payment_methods,
    } = payload as {
      customer_id: string; customer_name: string; customer_email: string | null
      job_id: string | null; amount: number; type: string
      notes: string | null; due_date: string | null; payment_methods: string[]
    }

    if (!job_id) {
      await supabase.from("assistant_approvals")
        .update({ status: "failed", error: "job_id is required", updated_at: now }).eq("id", id)
      return NextResponse.json(
        { error: "Invoice must be linked to a job — job_id is missing from approval payload." },
        { status: 400 },
      )
    }

    // Create the invoice (invoice_number assigned by DB trigger trg_invoice_number)
    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        customer_id,
        job_id,
        user_id:         ownerUserId,
        type:            type ?? "deposit",
        status:          "draft",
        amount:          Number(amount),
        due_date:        due_date ?? null,
        notes:           notes   ?? null,
        payment_methods: payment_methods ?? ["zelle", "cash", "check"],
      })
      .select("id, invoice_number")
      .single()

    if (invErr || !invoice) {
      await supabase.from("assistant_approvals")
        .update({ status: "failed", error: invErr?.message, updated_at: now }).eq("id", id)
      return NextResponse.json(
        { error: `Failed to create invoice: ${invErr?.message}` },
        { status: 500 },
      )
    }

    // If no email address, mark executed and return early — invoice is created
    if (!customer_email) {
      await supabase.from("assistant_approvals")
        .update({ status: "executed", executed_at: now,
          result: { invoice_id: invoice.id }, updated_at: now }).eq("id", id)
      return NextResponse.json({
        action_type:    "create_send_invoice",
        success:        true,
        invoice_id:     invoice.id,
        invoice_number: invoice.invoice_number ?? null,
        sent_to:        null,
        warning:        "Invoice created but no email address on file — could not send.",
      })
    }

    if (!smtpConfigured()) {
      await supabase.from("assistant_approvals")
        .update({ status: "executed", executed_at: now,
          result: { invoice_id: invoice.id }, updated_at: now }).eq("id", id)
      return NextResponse.json({
        action_type:    "create_send_invoice",
        success:        true,
        invoice_id:     invoice.id,
        invoice_number: invoice.invoice_number ?? null,
        sent_to:        null,
        warning:        "Invoice created but SMTP not configured — could not send email.",
      })
    }

    // Fetch company settings
    const { data: company } = await supabase
      .from("company_settings")
      .select("company_name, email, phone")
      .eq("user_id", ownerUserId)
      .maybeSingle()

    const companyName = company?.company_name ?? "Omdan"

    const BUILT_IN: Record<string, string> = { deposit: "Deposit", progress: "Progress", final: "Final" }
    const typeLabel = BUILT_IN[type as string]
      ?? String(type).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    const fmtAmount = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(Number(amount))

    const METHOD_LABELS: Record<string, string> = { zelle: "Zelle", cash: "Cash", check: "Check", venmo: "Venmo" }
    const methods     = (payment_methods as string[]) ?? []
    const methodsLine = methods.length > 0
      ? methods.map((m) => METHOD_LABELS[m] ?? m.charAt(0).toUpperCase() + m.slice(1)).join(", ")
      : "Contact us to arrange payment"

    // Fetch job title if needed
    let jobTitle = ""
    if (job_id) {
      const { data: jobRow } = await supabase.from("jobs").select("title").eq("id", job_id).single()
      jobTitle = jobRow?.title ?? ""
    }

    const bodyLines: string[] = [
      `Hi ${customer_name},`,
      "",
      "Please find your invoice details below.",
      "",
    ]
    if (invoice.invoice_number) bodyLines.push(`<strong>Invoice #:</strong> ${invoice.invoice_number}`)
    if (jobTitle)               bodyLines.push(`<strong>Job:</strong> ${jobTitle}`)
    bodyLines.push(
      `<strong>Type:</strong> ${typeLabel}`,
      `<strong>Amount Due:</strong> ${fmtAmount}`,
    )
    if (due_date) {
      const dueFmt = new Date(due_date + "T00:00:00").toLocaleDateString("en-US", {
        month: "long", day: "numeric", year: "numeric",
      })
      bodyLines.push(`<strong>Due Date:</strong> ${dueFmt}`)
    }
    if (notes) bodyLines.push("", String(notes))
    bodyLines.push("", `<strong>Payment Methods Accepted:</strong> ${methodsLine}`)
    if (company?.phone) bodyLines.push("", `Questions? Call us at ${company.phone}.`)

    const html = buildHtmlEmail({
      title:     `${typeLabel} Invoice${invoice.invoice_number ? ` — ${invoice.invoice_number}` : ""}`,
      preheader: `You have a ${typeLabel.toLowerCase()} invoice for ${fmtAmount}.`,
      companyName,
      bodyLines,
    })

    const plainText = [
      `Hi ${customer_name},`,
      "",
      "Please find your invoice details below.",
      "",
      invoice.invoice_number ? `Invoice #: ${invoice.invoice_number}` : "",
      jobTitle ? `Job: ${jobTitle}` : "",
      `Type: ${typeLabel}`,
      `Amount Due: ${fmtAmount}`,
      due_date ? `Due Date: ${due_date}` : "",
      notes    ? `\n${notes}`           : "",
      "",
      `Payment Methods Accepted: ${methodsLine}`,
      company?.phone ? `\nQuestions? Call us at ${company.phone}.` : "",
    ].filter(Boolean).join("\n")

    const subject = `Invoice from ${companyName}${invoice.invoice_number ? ` — ${invoice.invoice_number}` : ""}`

    let sendError: string | null = null
    try {
      const transporter = nodemailer.createTransport({
        host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
        port:   Number(process.env.SMTP_PORT ?? 587),
        secure: false,
        auth:   { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      })
      await transporter.sendMail({
        from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to:      customer_email,
        subject,
        text:    plainText,
        html,
      })
    } catch (err: unknown) {
      sendError = err instanceof Error ? err.message : String(err)
      console.error("[execute/create_send_invoice] email send failed:", sendError)
    }

    // Update invoice status only when email succeeded
    if (!sendError) {
      await supabase.from("invoices")
        .update({ status: "sent" })
        .eq("id", invoice.id)
        .eq("status", "draft")
    }

    // Log communication (best-effort)
    try {
      await supabase.from("communication_logs").insert({
        user_id:     ownerUserId,
        customer_id,
        job_id:      job_id ?? null,
        type:        "custom",
        subject,
        body:        sendError
          ? `Invoice ${invoice.invoice_number ?? invoice.id} created but email failed: ${sendError}`
          : `Invoice sent via Lia to ${customer_email}`,
        channel:     "email",
      })
    } catch { /* non-critical */ }

    // Mark approval executed
    await supabase.from("assistant_approvals")
      .update({
        status:       "executed",
        executed_at:  now,
        result:       { invoice_id: invoice.id, sent_to: sendError ? null : customer_email },
        updated_at:   now,
      })
      .eq("id", id)

    // Notify Lia (fire-and-forget) — only when email was sent
    if (!sendError) {
      notifyLia({
        event_type:     "invoice_sent",
        customer_name:  customer_name as string,
        customer_email: customer_email as string,
        document_name:  invoice.invoice_number
          ? `Invoice #${invoice.invoice_number}`
          : `${typeLabel} Invoice`,
        amount:         Number(amount),
        crm_url:        `${appUrl}/invoices/${invoice.id}`,
      })
    }

    if (sendError) {
      return NextResponse.json({
        action_type:    "create_send_invoice",
        success:        false,
        invoice_id:     invoice.id,
        invoice_number: invoice.invoice_number ?? null,
        sent_to:        null,
        warning:        `Invoice ${invoice.invoice_number ?? ""} created but email failed: ${sendError}`,
      })
    }

    return NextResponse.json({
      action_type:    "create_send_invoice",
      success:        true,
      invoice_id:     invoice.id,
      invoice_number: invoice.invoice_number ?? null,
      sent_to:        customer_email,
    })
  }

  return NextResponse.json({ error: `Unknown action_type: ${approval.action_type}` }, { status: 400 })
}
