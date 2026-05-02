import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"

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

  // ─── create_lead_estimate ─────────────────────────────────────────────────

  if (approval.action_type === "create_lead_estimate") {
    const lead  = payload.lead  as Record<string, string | undefined>
    const estData = payload.estimate as {
      services?: string; total?: number
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
        action_type:  "create_lead_estimate",
        customer_id:  customer.id,
        estimate_id:  null,
        send_approval_id: null,
        message: `Lead created for ${lead.name}.`,
      })
    }

    // Create draft estimate
    const total         = Number(estData.total)
    const estimateTitle = `${lead.name} — ${estData.services ?? "Estimate"}`
    const approvalToken = crypto.randomUUID()

    const { data: estimate, error: estErr } = await supabase
      .from("estimates")
      .insert({
        customer_id:        customer.id,
        user_id:            ownerUserId,
        title:              estimateTitle,
        scope_of_work:      estData.services ?? null,
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

    // Create approval for the send step
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app"
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
          estimate_title: estimateTitle,
          total,
          services:       estData.services,
          payment_steps:  estData.payment_steps ?? [],
          estimate_url:   `${appUrl}/estimates/${estimate.id}`,
        },
        requested_by_whatsapp:  approval.requested_by_whatsapp ?? null,
        requested_by_external:  approval.requested_by_external ?? null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    return NextResponse.json({
      action_type:      "create_lead_estimate",
      customer_id:      customer.id,
      estimate_id:      estimate.id,
      send_approval_id: sendApproval?.id ?? null,
      estimate_preview: {
        title:         estimateTitle,
        customer_name: lead.name as string,
        email:         lead.email ?? null,
        services:      estData.services ?? null,
        total,
        payment_steps: estData.payment_steps ?? [],
        estimate_url:  `${appUrl}/estimates/${estimate.id}`,
      },
    })
  }

  // ─── send_estimate ────────────────────────────────────────────────────────

  if (approval.action_type === "send_estimate") {
    const {
      estimate_id, customer_id, to_email, customer_name,
      estimate_title, total, services, payment_steps, estimate_url,
    } = payload as {
      estimate_id: string; customer_id: string; to_email: string | null
      customer_name: string; estimate_title: string; total: number
      services: string | null; payment_steps: Array<{ name: string; amount: number }>
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

    // Fetch company settings
    const { data: company } = await supabase
      .from("company_settings")
      .select("company_name, email, phone")
      .eq("user_id", ownerUserId)
      .maybeSingle()

    const companyName = company?.company_name ?? "Omdan"

    // Get approval token for the customer-facing approval link
    const { data: est } = await supabase
      .from("estimates")
      .select("approval_token")
      .eq("id", estimate_id)
      .single()

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app"
    const approvalLink = est?.approval_token
      ? `${appUrl}/approve-estimate/${est.approval_token}`
      : estimate_url

    // Build payment schedule lines for email
    const paymentLines = (payment_steps ?? []).map(
      (s) => `${s.name}: $${Number(s.amount).toLocaleString()}`
    )

    const bodyLines: string[] = [
      `Hi ${customer_name},`,
      "",
      `${companyName} has prepared an estimate for your project.`,
      "",
      `<strong>Services:</strong> ${services ?? estimate_title}`,
      `<strong>Total: $${Number(total).toLocaleString()}</strong>`,
    ]

    if (paymentLines.length) {
      bodyLines.push("", "<strong>Payment Schedule:</strong>")
      paymentLines.forEach((l) => bodyLines.push(`&nbsp;&nbsp;• ${l}`))
    }

    bodyLines.push("", "Please review and approve your estimate using the button below.")

    const html = buildHtmlEmail({
      title:       `Your Estimate from ${companyName}`,
      preheader:   `$${Number(total).toLocaleString()} estimate ready for your review`,
      companyName,
      bodyLines,
      ctaLabel:    "Review & Approve Estimate",
      ctaUrl:      approvalLink,
    })

    const transporter = createTransporter()
    await transporter.sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      to_email,
      subject: `Your Estimate from ${companyName}`,
      html,
    })

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
        body:        `Estimate sent via Lia assistant to ${to_email}`,
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
    })
  }

  return NextResponse.json({ error: `Unknown action_type: ${approval.action_type}` }, { status: 400 })
}
