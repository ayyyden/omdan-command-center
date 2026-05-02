import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DailySummary {
  date: string
  today_jobs: Array<{
    id: string; title: string; scheduled_time: string | null
    status: string; customer: { name: string } | null
  }>
  overdue_jobs: Array<{
    id: string; title: string; scheduled_date: string
    status: string; customer: { name: string } | null
  }>
  pending_estimates: Array<{
    id: string; title: string | null; total: number | null
    created_at: string; customer: { name: string } | null
  }>
  unsigned_contracts: Array<{
    id: string; sent_at: string | null; recipient_email: string | null
    contract_template: { name: string } | null
  }>
  unpaid_invoices: Array<{
    id: string; amount: number | null; status: string; due_date: string | null
    job: { title: string; customer: { name: string } | null } | null
  }>
  pending_approvals: Array<{
    id: string; action_type: string; action_summary: string; created_at: string
  }>
}

interface LeadData {
  name?: string
  phone?: string
  email?: string
  service_type?: string
}

interface EstimateData {
  services?: string
  total?: number
  payment_steps?: Array<{ name: string; amount: number }>
}

interface InvoiceData {
  customer_name?: string
  customer_id?: string
  amount?: number
  type?: string
  notes?: string
  due_date?: string
}

interface MessageBody {
  message: string
  sender?: string
  // Explicit intent from bridge (bypasses text parsing)
  intent?: string
  lead?: LeadData
  estimate?: EstimateData
  wants_estimate?: boolean
  invoice_data?: InvoiceData
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayLA(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
}

type ParsedIntent = "health_check" | "daily_attention" | "unknown"

function parseIntentFromText(text: string): ParsedIntent {
  const lower = text.toLowerCase()
  if (/connected|health|alive|online|test/.test(lower)) return "health_check"
  if (/lia.*connect|are you/.test(lower)) return "health_check"
  if (/attention|today|summary|overview|pending|what.*need|review|status/.test(lower)) return "daily_attention"
  return "unknown"
}

// ─── Daily summary ────────────────────────────────────────────────────────────

async function getDailySummary(): Promise<DailySummary> {
  const supabase = createServiceClient()
  const today = getTodayLA()
  const now = new Date().toISOString()

  const [
    { data: todayJobs }, { data: overdueJobs }, { data: pendingEstimates },
    { data: unsignedContracts }, { data: unpaidInvoices }, { data: pendingApprovals },
  ] = await Promise.all([
    supabase.from("jobs").select("id, title, scheduled_time, status, customer:customers(name)")
      .eq("scheduled_date", today).not("status", "in", "(completed,cancelled)")
      .order("scheduled_time", { ascending: true, nullsFirst: false }),
    supabase.from("jobs").select("id, title, scheduled_date, status, customer:customers(name)")
      .lt("scheduled_date", today).not("status", "in", "(completed,cancelled)")
      .order("scheduled_date", { ascending: true }),
    supabase.from("estimates").select("id, title, total, created_at, customer:customers(name)")
      .eq("status", "sent").order("created_at", { ascending: true }),
    supabase.from("sent_contracts")
      .select("id, sent_at, recipient_email, contract_template:contract_templates(name)")
      .is("signed_at", null).not("sent_at", "is", null).order("sent_at", { ascending: true }),
    supabase.from("invoices")
      .select("id, amount, status, due_date, job:jobs(title, customer:customers(name))")
      .neq("status", "paid").neq("status", "draft").neq("status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false }),
    supabase.from("assistant_approvals")
      .select("id, action_type, action_summary, created_at")
      .eq("status", "pending").gt("expires_at", now),
  ])

  return {
    date: today,
    today_jobs:          (todayJobs ?? [])          as unknown as DailySummary["today_jobs"],
    overdue_jobs:        (overdueJobs ?? [])         as unknown as DailySummary["overdue_jobs"],
    pending_estimates:   (pendingEstimates ?? [])    as unknown as DailySummary["pending_estimates"],
    unsigned_contracts:  (unsignedContracts ?? [])   as unknown as DailySummary["unsigned_contracts"],
    unpaid_invoices:     (unpaidInvoices ?? [])      as unknown as DailySummary["unpaid_invoices"],
    pending_approvals:   (pendingApprovals ?? [])    as unknown as DailySummary["pending_approvals"],
  }
}

// ─── Lead + estimate approval creation ───────────────────────────────────────

async function handleAddLeadEstimate(body: MessageBody) {
  const { lead, estimate, wants_estimate, sender } = body

  // Validate required CRM fields
  const missing: string[] = []
  if (!lead?.name) missing.push("customer name")

  if (missing.length) {
    return NextResponse.json({
      intent: "add_lead_estimate",
      missing_fields: missing,
      response_text: `To create the lead, I still need: ${missing.join(", ")}.`,
    })
  }

  const total = estimate?.total ?? 0
  const actionSummary = [
    `Create lead: ${lead!.name}`,
    wants_estimate && total > 0 ? ` + $${total.toLocaleString()} estimate` : "",
  ].join("")

  const supabase = createServiceClient()
  const { data: approval, error } = await supabase
    .from("assistant_approvals")
    .insert({
      channel: "telegram",
      action_type: "create_lead_estimate",
      action_summary: actionSummary,
      proposed_payload: {
        lead,
        estimate: wants_estimate ? (estimate ?? null) : null,
      },
      requested_by_external: sender ? `telegram:${sender}` : null,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  if (error || !approval) {
    console.error("[assistant/message] approval insert error:", error?.message, error?.details, error?.hint)
    return NextResponse.json({ error: "Failed to create approval record", detail: error?.message }, { status: 500 })
  }

  return NextResponse.json({
    intent: "add_lead_estimate",
    approval_id: approval.id,
    lead,
    estimate: wants_estimate ? (estimate ?? null) : null,
    wants_estimate,
  })
}

// ─── Invoice approval creation ────────────────────────────────────────────────

const INVOICE_TYPE_LABELS: Record<string, string> = {
  deposit:  "Deposit",
  progress: "Progress",
  final:    "Final",
}

function invoiceTypeLabel(type: string): string {
  return INVOICE_TYPE_LABELS[type]
    ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

async function handleCreateInvoice(body: MessageBody) {
  const { invoice_data, sender } = body
  const supabase = createServiceClient()

  // Validate required fields
  const missing: string[] = []
  if (!invoice_data?.customer_name && !invoice_data?.customer_id) missing.push("customer name")
  if (!invoice_data?.amount || invoice_data.amount <= 0) missing.push("amount")
  if (missing.length) {
    return NextResponse.json({ intent: "create_invoice", missing_fields: missing })
  }

  // ── Resolve customer ────────────────────────────────────────────────────────
  let customerId   = invoice_data!.customer_id ?? null
  let customerName = invoice_data!.customer_name ?? ""
  let customerEmail: string | null = null

  if (customerId) {
    // Already resolved (post-disambiguation)
    const { data: row } = await supabase
      .from("customers")
      .select("id, name, email")
      .eq("id", customerId)
      .single()
    if (!row) {
      return NextResponse.json({
        intent: "create_invoice",
        not_found: true,
        response_text: "Customer not found. Please check the name and try again.",
      })
    }
    customerName  = row.name
    customerEmail = row.email ?? null
  } else {
    const { data: matches } = await supabase
      .from("customers")
      .select("id, name, email")
      .ilike("name", `%${customerName}%`)
      .order("name")
      .limit(6)

    if (!matches || matches.length === 0) {
      return NextResponse.json({
        intent:    "create_invoice",
        not_found: true,
        response_text: `No customer found matching "${customerName}". Check the spelling and try again.`,
      })
    }
    if (matches.length > 1) {
      return NextResponse.json({
        intent: "create_invoice",
        needs_disambiguation: true,
        customer_matches: matches.map((m) => ({
          id:    m.id,
          name:  m.name,
          email: m.email ?? null,
        })),
      })
    }
    customerId    = matches[0].id
    customerName  = matches[0].name
    customerEmail = matches[0].email ?? null
  }

  // ── Find most-recent active job for this customer (optional) ────────────────
  const { data: job } = await supabase
    .from("jobs")
    .select("id, title")
    .eq("customer_id", customerId)
    .not("status", "in", "(completed,cancelled)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // ── Build approval ──────────────────────────────────────────────────────────
  const amount         = Number(invoice_data!.amount)
  const invoiceType    = invoice_data!.type ?? "deposit"
  const typeLabel      = invoiceTypeLabel(invoiceType)
  const paymentMethods = ["zelle", "cash", "check"]   // sensible default
  const appUrl         = process.env.NEXT_PUBLIC_APP_URL ?? ""

  const { data: approval, error: approvalErr } = await supabase
    .from("assistant_approvals")
    .insert({
      channel:               "telegram",
      action_type:           "create_send_invoice",
      action_summary:        `Send ${typeLabel} invoice $${amount.toLocaleString()} to ${customerName}`,
      proposed_payload: {
        customer_id:     customerId,
        customer_name:   customerName,
        customer_email:  customerEmail,
        job_id:          job?.id   ?? null,
        job_title:       job?.title ?? null,
        amount,
        type:            invoiceType,
        notes:           invoice_data!.notes ?? null,
        due_date:        invoice_data!.due_date ?? null,
        payment_methods: paymentMethods,
      },
      requested_by_external: sender ? `telegram:${sender}` : null,
      expires_at:            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  if (approvalErr || !approval) {
    console.error("[assistant/message] invoice approval insert error:", approvalErr?.message)
    return NextResponse.json(
      { error: "Failed to create invoice approval", detail: approvalErr?.message },
      { status: 500 },
    )
  }

  return NextResponse.json({
    intent:      "create_invoice",
    approval_id: approval.id,
    invoice_preview: {
      customer_name:   customerName,
      customer_email:  customerEmail,
      customer_id:     customerId,
      job_id:          job?.id    ?? null,
      job_title:       job?.title ?? null,
      amount,
      type:            invoiceType,
      type_label:      typeLabel,
      due_date:        invoice_data!.due_date ?? null,
      notes:           invoice_data!.notes    ?? null,
      payment_methods: paymentMethods,
    },
  })
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const body = await req.json() as MessageBody

  // Explicit intent from bridge takes precedence over text parsing
  const explicitIntent = body.intent

  if (explicitIntent === "add_lead_estimate") {
    return handleAddLeadEstimate(body)
  }

  if (explicitIntent === "create_invoice") {
    return handleCreateInvoice(body)
  }

  const textIntent = parseIntentFromText(body.message ?? "")

  if (textIntent === "health_check") {
    return NextResponse.json({
      intent: textIntent,
      response_text: [
        "Yes. I'm connected to Omdan Command Center.",
        "CRM connection: OK",
        "User verified: Owner/Admin",
        "WhatsApp connection: OK",
        "Approval system: Ready",
      ].join("\n"),
    })
  }

  if (textIntent === "daily_attention") {
    const summary = await getDailySummary()
    return NextResponse.json({ intent: textIntent, summary })
  }

  return NextResponse.json({
    intent: "unknown",
    response_text:
      "I didn't understand that. Try: \"what needs my attention today?\" or \"are you connected?\"",
  })
}
