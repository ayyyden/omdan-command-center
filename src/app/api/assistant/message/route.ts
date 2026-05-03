import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"
import { generateEstimateScope } from "@/lib/scope-generator"

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
  address?: string
  service_type?: string
  lead_source?: string
}

interface EstimateData {
  services?: string
  total?: number
  payment_steps?: Array<{ name: string; amount: number }>
  scope_override?: string
  generated_title?: string
  generated_scope?: string
}

interface InvoiceData {
  customer_name?: string
  customer_id?: string
  amount?: number
  type?: string
  notes?: string
  due_date?: string
  job_id?: string
  job_title_hint?: string
}

interface ScheduleData {
  customer_name?: string
  customer_id?: string
  job_id?: string
  job_title_hint?: string
  scheduled_date: string
  scheduled_time?: string | null
}

interface ContractData {
  customer_name?: string
  customer_id?: string
  job_id?: string
  job_title_hint?: string
  template_name_hint?: string
  template_ids?: string[]
  bundle_all?: boolean
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
  schedule_data?: ScheduleData
  contract_data?: ContractData
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

  // Pre-generate a professional title and scope so the Telegram approval preview
  // shows polished wording and the execute route can skip a second API call.
  let preTitle: string | null = null
  let preScope: string | null = null
  if (wants_estimate && (estimate?.services ?? lead?.service_type)) {
    try {
      const scopeResult = await generateEstimateScope(
        estimate?.services ?? lead?.service_type ?? "Project",
        estimate?.scope_override,
      )
      preTitle = scopeResult.title
      preScope = scopeResult.scope
    } catch {
      // Non-fatal — execute route will regenerate on approval
    }
  }

  const estimatePayload = wants_estimate
    ? { ...(estimate ?? {}), generated_title: preTitle, generated_scope: preScope }
    : null

  const supabase = createServiceClient()
  const { data: approval, error } = await supabase
    .from("assistant_approvals")
    .insert({
      channel: "telegram",
      action_type: "create_lead_estimate",
      action_summary: actionSummary,
      proposed_payload: {
        lead,
        estimate: estimatePayload,
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
    estimate: wants_estimate
      ? { ...(estimate ?? {}), generated_title: preTitle }
      : null,
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

  // ── Find and resolve job for this customer ──────────────────────────────────
  let jobId:    string | null = invoice_data!.job_id ?? null
  let jobTitle: string | null = null

  if (jobId) {
    // Pre-set job_id (post-disambiguation re-call) — verify it belongs to this customer
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("id", jobId)
      .eq("customer_id", customerId)
      .maybeSingle()
    if (!jobRow) {
      return NextResponse.json({
        intent:        "create_invoice",
        no_jobs:       true,
        response_text: `Job not found for ${customerName}. Please specify a valid job.`,
      })
    }
    jobTitle = jobRow.title
  } else {
    // Fetch all active jobs for this customer
    const { data: activeJobs } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("customer_id", customerId)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10)

    let jobs = activeJobs ?? []

    // Filter by title hint if provided and there are multiple jobs
    const hint = invoice_data!.job_title_hint ?? null
    if (hint && jobs.length > 1) {
      const hintLower = hint.toLowerCase()
      const filtered = jobs.filter((j) => j.title.toLowerCase().includes(hintLower))
      if (filtered.length > 0) jobs = filtered
    }

    if (jobs.length === 0) {
      return NextResponse.json({
        intent:        "create_invoice",
        no_jobs:       true,
        response_text: `No active jobs found for ${customerName}. Please create a job first — invoices must be connected to a job.`,
      })
    }

    if (jobs.length > 1) {
      return NextResponse.json({
        intent:                  "create_invoice",
        needs_job_selection:     true,
        resolved_customer_id:    customerId,
        resolved_customer_name:  customerName,
        resolved_customer_email: customerEmail,
        job_matches:             jobs.map((j) => ({ id: j.id, title: j.title })),
      })
    }

    // Exactly one active job — auto-select
    jobId    = jobs[0].id
    jobTitle = jobs[0].title
  }

  // ── Build approval ──────────────────────────────────────────────────────────
  const amount         = Number(invoice_data!.amount)
  const invoiceType    = invoice_data!.type ?? "deposit"
  const typeLabel      = invoiceTypeLabel(invoiceType)
  const paymentMethods = ["zelle", "cash", "check"]   // sensible default

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
        job_id:          jobId,
        job_title:       jobTitle,
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
      job_id:          jobId,
      job_title:       jobTitle,
      amount,
      type:            invoiceType,
      type_label:      typeLabel,
      due_date:        invoice_data!.due_date ?? null,
      notes:           invoice_data!.notes    ?? null,
      payment_methods: paymentMethods,
    },
  })
}

// ─── Schedule job approval creation ──────────────────────────────────────────

async function handleScheduleJob(body: MessageBody) {
  const { schedule_data, sender } = body
  const supabase = createServiceClient()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app").replace(/\/+$/, "")

  if (!schedule_data?.scheduled_date) {
    return NextResponse.json({
      intent: "schedule_job",
      missing_fields: ["scheduled_date"],
      response_text: "I need a date to schedule the job. Please include a date in your request.",
    })
  }

  const { scheduled_date, scheduled_time } = schedule_data

  // Helper: fetch full job details and create the approval
  async function createApprovalForJob(jobId: string) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, status, scheduled_date, scheduled_time, customer_id, project_manager:project_managers(name), customer:customers(name, address)")
      .eq("id", jobId)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({
        intent:        "schedule_job",
        not_found:     true,
        response_text: "Job not found. Please check and try again.",
      })
    }

    const jobAny      = job as Record<string, unknown>
    const pm          = jobAny.project_manager as { name: string } | null
    const customer    = jobAny.customer        as { name: string; address: string | null } | null
    const customerName = customer?.name ?? "Unknown"

    const { data: approval, error: approvalErr } = await supabase
      .from("assistant_approvals")
      .insert({
        channel:               "telegram",
        action_type:           "schedule_job",
        action_summary:        `Schedule "${job.title as string}" for ${customerName} on ${scheduled_date}`,
        proposed_payload: {
          job_id:                   job.id,
          job_title:                job.title,
          customer_name:            customerName,
          customer_address:         customer?.address ?? null,
          job_status:               job.status,
          current_scheduled_date:   job.scheduled_date ?? null,
          current_scheduled_time:   job.scheduled_time ?? null,
          new_scheduled_date:       scheduled_date,
          new_scheduled_time:       scheduled_time ?? null,
          pm_name:                  pm?.name ?? null,
        },
        requested_by_external: sender ? `telegram:${sender}` : null,
        expires_at:            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    if (approvalErr || !approval) {
      console.error("[assistant/message] schedule approval insert error:", approvalErr?.message)
      return NextResponse.json(
        { error: "Failed to create schedule approval", detail: approvalErr?.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      intent:      "schedule_job",
      approval_id: approval.id,
      schedule_preview: {
        job_id:                 job.id,
        job_title:              job.title as string,
        job_status:             job.status as string,
        customer_name:          customerName,
        customer_address:       customer?.address ?? null,
        current_scheduled_date: (job.scheduled_date as string | null) ?? null,
        current_scheduled_time: (job.scheduled_time as string | null) ?? null,
        new_scheduled_date:     scheduled_date,
        new_scheduled_time:     scheduled_time ?? null,
        pm_name:                pm?.name ?? null,
        crm_url:                `${appUrl}/jobs/${job.id as string}`,
      },
    })
  }

  // ── job_id pre-set (post-disambiguation) ──────────────────────────────────
  if (schedule_data.job_id) {
    return createApprovalForJob(schedule_data.job_id)
  }

  // ── customer_id pre-set (post-customer-disambiguation) ────────────────────
  if (schedule_data.customer_id) {
    const hint = schedule_data.job_title_hint ?? null
    const jobQuery = supabase
      .from("jobs")
      .select("id, title")
      .eq("customer_id", schedule_data.customer_id)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10)

    const { data: customerJobs } = await jobQuery
    let jobs = customerJobs ?? []

    if (hint && jobs.length > 1) {
      const filtered = jobs.filter((j) => j.title.toLowerCase().includes(hint.toLowerCase()))
      if (filtered.length > 0) jobs = filtered
    }

    if (jobs.length === 0) {
      return NextResponse.json({
        intent:        "schedule_job",
        no_jobs:       true,
        response_text: `No active jobs found for this customer. A job must exist before scheduling.`,
      })
    }
    if (jobs.length > 1) {
      return NextResponse.json({
        intent:                      "schedule_job",
        needs_schedule_job_selection: true,
        job_matches:                 jobs.map((j) => ({ id: j.id, title: j.title })),
      })
    }
    return createApprovalForJob(jobs[0].id)
  }

  // ── customer_name provided → search for matching customer ─────────────────
  if (schedule_data.customer_name) {
    const { data: customerMatches } = await supabase
      .from("customers")
      .select("id, name")
      .ilike("name", `%${schedule_data.customer_name}%`)
      .order("name")
      .limit(6)

    const matches = customerMatches ?? []

    if (matches.length === 0) {
      // Fall back to job title search if hint available
      if (schedule_data.job_title_hint) {
        const { data: jobMatches } = await supabase
          .from("jobs")
          .select("id, title")
          .ilike("title", `%${schedule_data.job_title_hint}%`)
          .not("status", "in", "(completed,cancelled)")
          .order("created_at", { ascending: false })
          .limit(6)

        const jm = jobMatches ?? []
        if (jm.length === 1) return createApprovalForJob(jm[0].id)
        if (jm.length > 1) {
          return NextResponse.json({
            intent:                      "schedule_job",
            needs_schedule_job_selection: true,
            job_matches:                 jm.map((j) => ({ id: j.id, title: j.title })),
          })
        }
      }
      return NextResponse.json({
        intent:        "schedule_job",
        not_found:     true,
        response_text: `No customer found matching "${schedule_data.customer_name}". Check the spelling and try again.`,
      })
    }

    if (matches.length > 1) {
      return NextResponse.json({
        intent:                       "schedule_job",
        needs_customer_disambiguation: true,
        customer_matches:             matches.map((m) => ({ id: m.id, name: m.name, email: null })),
        resolved_scheduled_date:      scheduled_date,
        resolved_scheduled_time:      scheduled_time ?? null,
        resolved_job_title_hint:      schedule_data.job_title_hint ?? null,
      })
    }

    // Exactly 1 customer match
    const customerId = matches[0].id
    const hint = schedule_data.job_title_hint ?? null

    const { data: custJobs } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("customer_id", customerId)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10)

    let jobs2 = custJobs ?? []
    if (hint && jobs2.length > 1) {
      const filtered = jobs2.filter((j) => j.title.toLowerCase().includes(hint.toLowerCase()))
      if (filtered.length > 0) jobs2 = filtered
    }

    if (jobs2.length === 0) {
      return NextResponse.json({
        intent:        "schedule_job",
        no_jobs:       true,
        response_text: `No active jobs found for ${matches[0].name}. A job must exist before scheduling.`,
      })
    }
    if (jobs2.length > 1) {
      return NextResponse.json({
        intent:                      "schedule_job",
        needs_schedule_job_selection: true,
        job_matches:                 jobs2.map((j) => ({ id: j.id, title: j.title })),
      })
    }
    return createApprovalForJob(jobs2[0].id)
  }

  // ── No customer name — search jobs by title hint ───────────────────────────
  if (schedule_data.job_title_hint) {
    const { data: jobMatches } = await supabase
      .from("jobs")
      .select("id, title")
      .ilike("title", `%${schedule_data.job_title_hint}%`)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(6)

    const jm = jobMatches ?? []
    if (jm.length === 0) {
      return NextResponse.json({
        intent:        "schedule_job",
        not_found:     true,
        response_text: `No active job found matching "${schedule_data.job_title_hint}". Check the name and try again.`,
      })
    }
    if (jm.length === 1) return createApprovalForJob(jm[0].id)
    return NextResponse.json({
      intent:                      "schedule_job",
      needs_schedule_job_selection: true,
      job_matches:                 jm.map((j) => ({ id: j.id, title: j.title })),
    })
  }

  return NextResponse.json({
    intent:        "schedule_job",
    missing_fields: ["customer_name"],
    response_text: "I need a customer name or job title to find the job to schedule.",
  })
}

// ─── Contract send approval creation ─────────────────────────────────────────

async function handleSendContract(body: MessageBody) {
  const { contract_data, sender } = body
  const supabase = createServiceClient()
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app").replace(/\/+$/, "")

  // Helper: resolve customer email, then templates, then create approval
  async function buildApproval(customerId: string, customerName: string, customerEmail: string | null, jobId: string | null, jobTitle: string | null) {
    if (!customerEmail) {
      return NextResponse.json({
        intent:        "send_contract",
        no_email:      true,
        response_text: `${customerName} has no email address on file. Add an email to the customer record first.`,
      })
    }

    // Resolve templates
    const templateIds = contract_data?.template_ids ?? null
    const nameHint    = contract_data?.template_name_hint ?? null
    const bundleAll   = contract_data?.bundle_all ?? false

    let selectedTemplates: Array<{ id: string; name: string }> = []

    if (templateIds?.length) {
      // Already selected — validate
      const { data } = await supabase
        .from("contract_templates")
        .select("id, name")
        .in("id", templateIds)
        .eq("is_active", true)
      selectedTemplates = data ?? []
      if (!selectedTemplates.length) {
        return NextResponse.json({
          intent:        "send_contract",
          not_found:     true,
          response_text: "Selected contract template(s) not found or inactive.",
        })
      }
    } else {
      // Fetch owner's active templates
      const ownerEmail = process.env.ASSISTANT_OWNER_EMAIL
      let ownerUserId: string | null = null
      if (ownerEmail) {
        const { data: ownerRow } = await supabase
          .from("team_members")
          .select("user_id")
          .ilike("email", ownerEmail)
          .not("user_id", "is", null)
          .single()
        ownerUserId = (ownerRow?.user_id as string) ?? null
      }
      if (!ownerUserId) {
        const { data: byRole } = await supabase
          .from("team_members")
          .select("user_id")
          .eq("role", "owner")
          .eq("status", "active")
          .not("user_id", "is", null)
          .single()
        ownerUserId = (byRole?.user_id as string) ?? null
      }
      if (!ownerUserId) {
        return NextResponse.json({ error: "Owner not found" }, { status: 500 })
      }

      const { data: allTemplates } = await supabase
        .from("contract_templates")
        .select("id, name")
        .eq("user_id", ownerUserId)
        .eq("is_active", true)
        .order("created_at", { ascending: true })

      const templates = allTemplates ?? []

      if (!templates.length) {
        return NextResponse.json({
          intent:        "send_contract",
          no_templates:  true,
          response_text: "No contract templates are set up. Add templates in the CRM first.",
        })
      }

      if (bundleAll) {
        // User wants all templates
        selectedTemplates = templates
      } else if (nameHint) {
        // Filter by name hint
        const filtered = templates.filter((t) =>
          t.name.toLowerCase().includes(nameHint.toLowerCase())
        )
        if (filtered.length === 1) {
          selectedTemplates = filtered
        } else if (filtered.length > 1) {
          // Multiple matches — let user pick
          return NextResponse.json({
            intent:                  "send_contract",
            needs_template_selection: true,
            available_templates:     filtered.map((t) => ({ id: t.id, name: t.name })),
          })
        } else {
          // No name match — show all templates
          if (templates.length === 1) {
            selectedTemplates = templates
          } else {
            return NextResponse.json({
              intent:                  "send_contract",
              needs_template_selection: true,
              available_templates:     templates.map((t) => ({ id: t.id, name: t.name })),
            })
          }
        }
      } else if (templates.length === 1) {
        // Exactly one template — auto-select
        selectedTemplates = templates
      } else {
        // Multiple templates, no hint → let user pick
        return NextResponse.json({
          intent:                  "send_contract",
          needs_template_selection: true,
          available_templates:     templates.map((t) => ({ id: t.id, name: t.name })),
        })
      }
    }

    // Build action summary
    const templateNames = selectedTemplates.map((t) => t.name).join(", ")
    const actionSummary = `Send contract to ${customerName}${jobTitle ? ` for ${jobTitle}` : ""}: ${templateNames}`

    const { data: approval, error: approvalErr } = await supabase
      .from("assistant_approvals")
      .insert({
        channel:               "telegram",
        action_type:           "send_contracts",
        action_summary:        actionSummary,
        proposed_payload: {
          customer_id:    customerId,
          customer_name:  customerName,
          customer_email: customerEmail,
          job_id:         jobId,
          job_title:      jobTitle,
          template_ids:   selectedTemplates.map((t) => t.id),
        },
        requested_by_external: sender ? `telegram:${sender}` : null,
        expires_at:            new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single()

    if (approvalErr || !approval) {
      console.error("[assistant/message] contract approval insert error:", approvalErr?.message)
      return NextResponse.json(
        { error: "Failed to create contract approval", detail: approvalErr?.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      intent:      "send_contract",
      approval_id: approval.id,
      contract_preview: {
        customer_name:  customerName,
        customer_email: customerEmail,
        customer_id:    customerId,
        job_id:         jobId,
        job_title:      jobTitle,
        templates:      selectedTemplates.map((t) => ({ id: t.id, name: t.name })),
        signing_mode:   "bundle" as const,
        crm_url:        jobId ? `${appUrl}/jobs/${jobId}` : `${appUrl}/customers/${customerId}`,
      },
    })
  }

  // ── job_id pre-set → verify and proceed ───────────────────────────────────
  if (contract_data?.job_id) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, customer:customers(id, name, email)")
      .eq("id", contract_data.job_id)
      .maybeSingle()

    if (!job) {
      return NextResponse.json({ intent: "send_contract", not_found: true, response_text: "Job not found." })
    }
    const cust = job.customer as unknown as { id: string; name: string; email: string | null } | null
    return buildApproval(
      cust?.id ?? "", cust?.name ?? "Customer", cust?.email ?? null,
      job.id as string, job.title as string,
    )
  }

  // ── customer_id pre-set → find job ────────────────────────────────────────
  if (contract_data?.customer_id) {
    const { data: customer } = await supabase
      .from("customers")
      .select("id, name, email")
      .eq("id", contract_data.customer_id)
      .single()

    if (!customer) {
      return NextResponse.json({ intent: "send_contract", not_found: true, response_text: "Customer not found." })
    }

    const hint = contract_data.job_title_hint ?? null
    const { data: custJobs } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("customer_id", customer.id)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10)

    let jobs = custJobs ?? []
    if (hint && jobs.length > 1) {
      const filtered = jobs.filter((j) => j.title.toLowerCase().includes(hint.toLowerCase()))
      if (filtered.length > 0) jobs = filtered
    }

    if (jobs.length === 0) {
      return buildApproval(customer.id, customer.name, customer.email ?? null, null, null)
    }
    if (jobs.length === 1) {
      return buildApproval(customer.id, customer.name, customer.email ?? null, jobs[0].id, jobs[0].title)
    }
    return NextResponse.json({
      intent:                    "send_contract",
      needs_contract_job_selection: true,
      job_matches:               jobs.map((j) => ({ id: j.id, title: j.title })),
    })
  }

  // ── customer_name provided → search ───────────────────────────────────────
  if (contract_data?.customer_name) {
    const { data: customerMatches } = await supabase
      .from("customers")
      .select("id, name, email")
      .ilike("name", `%${contract_data.customer_name}%`)
      .order("name")
      .limit(6)

    const matches = customerMatches ?? []

    if (matches.length === 0) {
      return NextResponse.json({
        intent:        "send_contract",
        not_found:     true,
        response_text: `No customer found matching "${contract_data.customer_name}". Check the spelling and try again.`,
      })
    }

    if (matches.length > 1) {
      return NextResponse.json({
        intent:                             "send_contract",
        needs_contract_customer_disambiguation: true,
        customer_matches:                   matches.map((m) => ({ id: m.id, name: m.name, email: m.email ?? null })),
      })
    }

    const customer = matches[0]
    const hint = contract_data.job_title_hint ?? null

    const { data: custJobs } = await supabase
      .from("jobs")
      .select("id, title")
      .eq("customer_id", customer.id)
      .not("status", "in", "(completed,cancelled)")
      .order("created_at", { ascending: false })
      .limit(10)

    let jobs2 = custJobs ?? []
    if (hint && jobs2.length > 1) {
      const filtered = jobs2.filter((j) => j.title.toLowerCase().includes(hint.toLowerCase()))
      if (filtered.length > 0) jobs2 = filtered
    }

    if (jobs2.length === 0) {
      return buildApproval(customer.id, customer.name, customer.email ?? null, null, null)
    }
    if (jobs2.length === 1) {
      return buildApproval(customer.id, customer.name, customer.email ?? null, jobs2[0].id, jobs2[0].title)
    }
    return NextResponse.json({
      intent:                    "send_contract",
      needs_contract_job_selection: true,
      job_matches:               jobs2.map((j) => ({ id: j.id, title: j.title })),
    })
  }

  return NextResponse.json({
    intent:         "send_contract",
    missing_fields: ["customer_name"],
    response_text:  "I need a customer name to find who to send the contract to.",
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

  if (explicitIntent === "schedule_job") {
    return handleScheduleJob(body)
  }

  if (explicitIntent === "send_contract") {
    return handleSendContract(body)
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
