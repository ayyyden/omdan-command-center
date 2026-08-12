// Shared Claude brain logic — used by /api/assistant/conversations/[id]/messages
// and /api/assistant/telegram-chat.
//
// Uses Claude's real tool-calling (not a hand-parsed JSON blob in the reply
// text) — every proposed action is a `tools[]` entry, so a malformed response
// can no longer produce a swallowed JSON.parse failure. Read-only tools
// (currently just list_reminders) resolve inline in a short server-side tool
// loop; write tools always stop and become a pending approval — Lia never
// executes anything directly.

import Anthropic from "@anthropic-ai/sdk"
import { createServiceClient } from "@/lib/supabase/service"

export interface ActionDraft {
  type:       string
  summary:    string
  payload:    Record<string, unknown>
  risk_level: "low" | "medium" | "high"
}

export interface BrainResponse {
  message: string
  action?: ActionDraft
}

// ─── CRM context builder ──────────────────────────────────────────────────────

export function buildCrmContext(
  customers:    Array<{ id: string; name: string; phone: string | null; email: string | null; status: string | null }> | null,
  jobs:         Array<{ id: string; title: string; status: string; scheduled_date: string | null; customer_id: string }> | null,
  appointments: Array<{ id: string; customer_id: string | null; scheduled_date: string; project_summary: string | null; status: string; source: string | null }> | null = null,
): string {
  const lines: string[] = []

  if (customers?.length) {
    lines.push("RECENT CUSTOMERS:")
    for (const c of customers) {
      const jobList = (jobs ?? [])
        .filter((j) => j.customer_id === c.id)
        .map((j) => j.title)
        .join(", ")
      lines.push(
        `  id=${c.id} | name="${c.name}" | phone=${c.phone ?? "none"} | email=${c.email ?? "none"} | status=${c.status ?? "?"} | jobs=[${jobList || "none"}]`,
      )
    }
  } else {
    lines.push("RECENT CUSTOMERS: (none yet)")
  }

  if (jobs?.length) {
    lines.push("")
    lines.push("ACTIVE JOBS:")
    const custMap = Object.fromEntries((customers ?? []).map((c) => [c.id, c.name]))
    for (const j of jobs) {
      lines.push(
        `  id=${j.id} | title="${j.title}" | customer="${custMap[j.customer_id] ?? "?"}" | customer_id=${j.customer_id} | status=${j.status} | scheduled=${j.scheduled_date ?? "none"}`,
      )
    }
  } else {
    lines.push("")
    lines.push("ACTIVE JOBS: (none yet)")
  }

  if (appointments?.length) {
    lines.push("")
    lines.push("LEAD APPOINTMENTS (upcoming/recent):")
    const custMap2 = Object.fromEntries((customers ?? []).map((c) => [c.id, c.name]))
    for (const a of appointments) {
      const custName = a.customer_id ? (custMap2[a.customer_id] ?? "?") : "?"
      lines.push(
        `  id=${a.id} | customer="${custName}" | customer_id=${a.customer_id ?? "none"} | date=${a.scheduled_date} | project=${a.project_summary ?? "?"} | status=${a.status}`,
      )
    }
  } else {
    lines.push("")
    lines.push("LEAD APPOINTMENTS: (none)")
  }

  return lines.join("\n")
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(crmContext: string, today: string): string {
  return `You are Lia, the AI assistant for Omdan Development — a residential construction and landscaping company. You help the team manage customers, jobs, invoices, estimates, scheduling, payments, and their daily to-do list, by chatting naturally in Telegram (both direct messages and a shared team group chat) and in the CRM's own chat page.

TODAY: ${today}

APPROVAL-FIRST RULE: You never execute anything directly. When a tool call would change data (create, update, complete, record — anything but looking something up), that tool call is only a *proposal* — the human always sees an approve/reject/edit card first, and nothing happens until they approve it. Only \`list_reminders\` and \`list_bank_transactions\` are lookups — call them freely, as many times as needed, to answer questions.

BANK TRANSACTIONS: You can see connected bank accounts' transactions via list_bank_transactions. If one clearly matches an expense or payment the user is describing (same amount, close date), mention it and set bank_transaction_id on the create_expense/record_payment proposal so it gets linked — but only when you're confident, and always let the user correct it via the approval card.

GROUP CHAT: Some conversations are a shared group chat with multiple team members talking to you in one thread. When that's the case, user messages are prefixed with the sender's name (e.g. "Edan: can you...") so you know who said what — use that to keep track of who's asking, but never include that prefix format in your own replies, and don't confuse one person's earlier statement for another's.

STYLE: Be concise — 1 to 3 sentences unless the user asks for detail. Sound like a sharp, competent teammate texting back, not a form. Never say "I cannot do that" for anything in your toolset — instead propose the action or ask exactly one focused follow-up question if something required is missing.

RULES:
- Always use real UUIDs copied from CRM CONTEXT below — never invent an id, phone number, date, or address. If someone isn't in CRM CONTEXT, don't guess an id for them — either ask the user to add them first, or use create_customer.
- A job's title should be the property's street address whenever one is known (e.g. "82388 Odlum Dr"), never a service description like "Pavers" — that convention is enforced elsewhere in the CRM too, so follow it when you set or change a job's title.
- Do not invent brands, measurements, warranties, or anything the user did not specify.
- Before proposing create_lead_appointment, check LEAD APPOINTMENTS in CRM CONTEXT — if the same customer already has one within 7 days of the requested date, mention that in your message, but still propose the action so the user can decide.
- If the user asks to cancel or change a pending approval, tell them to reject the card, then re-describe what they want.
- If you're just greeting, chatting, or answering a question with no data-changing intent, reply naturally with no tool call at all.

CRM CONTEXT:
${crmContext}`
}

// ─── Tool catalog ─────────────────────────────────────────────────────────────

const SUMMARY_PROP = {
  summary: {
    type: "string" as const,
    description: "One-line, human-readable description of what this action will do, shown to the user on the approval card (e.g. \"Add customer Jane Doe\", \"Record $500 payment on the Smith job\").",
  },
}

const TOOLS: Anthropic.Tool[] = [
  {
    name: "create_customer",
    description: "Add a new customer/client/lead to the CRM. Use when someone describes a new potential client who isn't already in CRM CONTEXT.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        name:         { type: "string", description: "Required." },
        phone:        { type: ["string", "null"] },
        email:        { type: ["string", "null"] },
        address:      { type: ["string", "null"] },
        service_type: { type: ["string", "null"], description: "Short description of what work they need." },
        lead_source:  { type: ["string", "null"] },
        notes:        { type: ["string", "null"], description: "Full project details." },
      },
      required: ["summary", "name"],
    },
  },
  {
    name: "update_customer",
    description: "Edit an existing customer's info or lead status. customer_id must come from CRM CONTEXT.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        customer_id:  { type: "string" },
        status:       { type: ["string", "null"], description: "One of: New Lead, Contacted, Estimate Sent, Follow-Up Needed, Approved, Scheduled, In Progress, Completed, Paid, Closed Lost." },
        phone:        { type: ["string", "null"] },
        email:        { type: ["string", "null"] },
        address:      { type: ["string", "null"] },
        service_type: { type: ["string", "null"] },
        notes:        { type: ["string", "null"] },
      },
      required: ["summary", "customer_id"],
    },
  },
  {
    name: "create_job",
    description: "Create a new job for an existing customer — use when the user wants to formally start a job or convert a lead visit into one. customer_id is REQUIRED and must be from CRM CONTEXT — if the customer isn't there, ask them to create the customer first.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        customer_id:         { type: "string" },
        customer_name:       { type: "string" },
        lead_appointment_id: { type: ["string", "null"] },
        title:                { type: ["string", "null"], description: "Prefer the customer's street address (see job-title rule); fall back to a short service description only if no address is known." },
        description:          { type: ["string", "null"] },
        status:                { type: "string", enum: ["scheduled", "in_progress"] },
        scheduled_date:        { type: ["string", "null"], description: "YYYY-MM-DD" },
      },
      required: ["summary", "customer_id", "customer_name", "status"],
    },
  },
  {
    name: "update_job",
    description: "Edit an existing job — reschedule it, change its status, reassign the project manager, or update its title/description. job_id must come from CRM CONTEXT.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        job_id:              { type: "string" },
        job_title:           { type: "string", description: "The job's current title, for display only." },
        scheduled_date:      { type: ["string", "null"], description: "YYYY-MM-DD" },
        scheduled_time:      { type: ["string", "null"], description: "HH:MM 24h" },
        status:              { type: ["string", "null"], enum: ["scheduled", "in_progress", "completed", "on_hold", "cancelled", null] },
        project_manager_id:  { type: ["string", "null"] },
        title:               { type: ["string", "null"] },
        description:         { type: ["string", "null"] },
      },
      required: ["summary", "job_id", "job_title"],
    },
  },
  {
    name: "create_estimate_draft",
    description: "Create a DRAFT estimate for an existing customer — does not email anything. After approval, a separate \"send to customer?\" approval appears automatically. No job_id needed. Use whenever the user asks to make/create/send an estimate — never skip straight to sending.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        customer_id:    { type: "string" },
        customer_name:  { type: "string" },
        customer_email: { type: ["string", "null"] },
        services:       { type: "string" },
        total:          { type: "number" },
        payment_steps:  {
          type: ["array", "null"],
          description: "Extract every labeled amount from the message (e.g. \"Down payment $770\", \"balance on completion $2000\") — the first Total line is the overall total, not a step.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, amount: { type: "number" } },
            required: ["name", "amount"],
          },
        },
      },
      required: ["summary", "customer_id", "customer_name", "services", "total"],
    },
  },
  {
    name: "create_invoice",
    description: "Create a DRAFT invoice (not emailed). job_id is REQUIRED — if the customer has no jobs in CRM CONTEXT, ask which job first.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        customer_id:     { type: "string" },
        customer_name:   { type: "string" },
        job_id:          { type: "string" },
        job_title:       { type: "string" },
        amount:          { type: "number" },
        type:            { type: "string", enum: ["deposit", "progress", "final", "other"] },
        notes:           { type: ["string", "null"] },
        due_date:        { type: ["string", "null"], description: "YYYY-MM-DD" },
        payment_methods: { type: "array", items: { type: "string", enum: ["zelle", "cash", "check", "venmo", "credit_card", "bank_transfer", "other"] } },
      },
      required: ["summary", "customer_id", "job_id", "amount", "type"],
    },
  },
  {
    name: "create_send_invoice",
    description: "Create an invoice AND email it to the customer immediately. Only use when the user explicitly wants it sent right away and a customer_email is known.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        customer_id:     { type: "string" },
        customer_name:   { type: "string" },
        customer_email:  { type: "string" },
        job_id:          { type: "string" },
        job_title:       { type: "string" },
        amount:          { type: "number" },
        type:            { type: "string", enum: ["deposit", "progress", "final", "other"] },
        notes:           { type: ["string", "null"] },
        due_date:        { type: ["string", "null"] },
        payment_methods: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "customer_id", "customer_email", "job_id", "amount", "type"],
    },
  },
  {
    name: "record_payment",
    description: "Record that a payment was received against a job. job_id and customer_id must come from CRM CONTEXT.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        job_id:              { type: "string" },
        customer_id:         { type: "string" },
        amount:              { type: "number" },
        method:              { type: "string", enum: ["cash", "check", "zelle", "venmo", "credit_card", "bank_transfer", "other"] },
        date:                { type: ["string", "null"], description: "YYYY-MM-DD, defaults to today" },
        invoice_id:          { type: ["string", "null"] },
        notes:               { type: ["string", "null"] },
        bank_transaction_id: { type: ["string", "null"], description: "Set only when this payment matches a specific bank transaction surfaced by list_bank_transactions — links them together." },
      },
      required: ["summary", "job_id", "customer_id", "amount", "method"],
    },
  },
  {
    name: "create_expense",
    description: "Record a business or job expense (e.g. \"I spent $50 on gas\").",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        amount:              { type: "number" },
        vendor:              { type: ["string", "null"] },
        category:            { type: "string", enum: ["gas", "meals", "materials", "labor", "equipment", "tools", "vehicle", "travel", "permits", "dump_fees", "subcontractors", "office_rent", "software", "insurance", "marketing", "misc"] },
        date:                { type: "string", description: "YYYY-MM-DD, use today if not specified" },
        notes:               { type: ["string", "null"] },
        job_id:              { type: ["string", "null"], description: "Only if the user names a specific job from CRM CONTEXT." },
        bank_transaction_id: { type: ["string", "null"], description: "Set only when this expense matches a specific bank transaction surfaced by list_bank_transactions — links them together." },
      },
      required: ["summary", "amount", "category", "date"],
    },
  },
  {
    name: "create_reminder",
    description: "Add something to the to-do/reminders list — a task, follow-up, or thing to remember for a specific day. This is how you add to someone's daily to-do list.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        title:       { type: "string" },
        due_date:    { type: "string", description: "YYYY-MM-DD — use today if the user just says \"today\"." },
        due_time:    { type: ["string", "null"], description: "HH:MM 24h, if a specific time was mentioned." },
        type:        { type: "string", enum: ["estimate_follow_up", "payment_reminder", "material_reminder", "review_request", "custom"] },
        customer_id: { type: ["string", "null"] },
        job_id:      { type: ["string", "null"] },
        notes:       { type: ["string", "null"] },
      },
      required: ["summary", "title", "due_date", "type"],
    },
  },
  {
    name: "list_reminders",
    description: "Look up the to-do/reminders list — read-only, does not need approval, call this whenever asked what's on the list, what's due, or what's overdue.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["today", "overdue", "upcoming"], description: "\"today\" = due today, \"overdue\" = past due and not done, \"upcoming\" = due in the next 7 days." },
      },
      required: ["scope"],
    },
  },
  {
    name: "complete_reminder",
    description: "Mark a to-do/reminder as done. Look it up with list_reminders first if you don't already have its id from CRM CONTEXT or earlier in this conversation.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        reminder_id: { type: "string" },
        title:       { type: "string", description: "The reminder's title, for display only." },
      },
      required: ["summary", "reminder_id", "title"],
    },
  },
  {
    name: "update_note",
    description: "Replace the internal notes on a customer or job.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        entity_type: { type: "string", enum: ["customer", "job"] },
        entity_id:   { type: "string" },
        entity_name: { type: "string" },
        notes:       { type: "string" },
      },
      required: ["summary", "entity_type", "entity_id", "notes"],
    },
  },
  {
    name: "list_bank_transactions",
    description: "Look up recent connected-bank-account transactions — read-only, does not need approval. Use this to answer questions about bank activity, or to find a transaction to link when proposing record_payment/create_expense (pass its id as bank_transaction_id).",
    input_schema: {
      type: "object",
      properties: {
        match_status: { type: ["string", "null"], enum: ["unmatched", "suggested", "confirmed", "ignored", null], description: "Filter by match status. Omit to see all." },
        search:       { type: ["string", "null"], description: "Filter by merchant/description text." },
        limit:        { type: ["number", "null"], description: "Defaults to 20, max 50." },
      },
      required: [],
    },
  },
  {
    name: "create_lead_appointment",
    description: "Record a new lead/appointment someone told you about — a new person's name with contact info, a date/time, or a location, in any format (formal, forwarded, informal, with or without labels). scheduled_date and name are the minimum needed — ask for scheduled_date if it's missing rather than guessing. Do not create a job or estimate in the same call.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        name:               { type: "string" },
        phone:              { type: ["string", "null"] },
        address:            { type: ["string", "null"] },
        scheduled_date:     { type: ["string", "null"], description: "YYYY-MM-DD" },
        start_time:         { type: ["string", "null"] },
        end_time:           { type: ["string", "null"] },
        partner_reference:  { type: ["string", "null"] },
        category_code:      { type: ["string", "null"] },
        project_summary:    { type: ["string", "null"] },
        notes:              { type: ["string", "null"] },
      },
      required: ["summary", "name"],
    },
  },
  {
    name: "create_calendar_event",
    description: "Put an appointment/meeting/site visit on the company Google Calendar — use this whenever someone asks to schedule, book, or set an appointment that isn't specifically a new lead's first contact (for a brand-new lead's initial appointment, use create_lead_appointment instead). Can optionally link to an existing customer or job from CRM CONTEXT.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        title:            { type: "string", description: "Short event title, e.g. \"Site visit — Smith job\" or \"Meeting with John Doe\"." },
        date:             { type: "string", description: "YYYY-MM-DD" },
        start_time:       { type: "string", description: "HH:MM 24h" },
        duration_minutes: { type: ["number", "null"], description: "Defaults to 60 if not specified." },
        location:         { type: ["string", "null"], description: "Address or place, if known." },
        notes:            { type: ["string", "null"], description: "Event description/details." },
        customer_id:      { type: ["string", "null"], description: "From CRM CONTEXT, if this appointment is tied to an existing customer." },
        job_id:           { type: ["string", "null"], description: "From CRM CONTEXT, if this appointment is tied to an existing job." },
      },
      required: ["summary", "title", "date", "start_time"],
    },
  },
]

const READ_ONLY_TOOLS = new Set(["list_reminders", "list_bank_transactions"])

const ACTION_RISK: Record<string, "low" | "medium" | "high"> = {
  create_send_invoice: "medium",
  record_payment:      "medium",
}

// ─── Read-only tool execution ─────────────────────────────────────────────────

async function runListReminders(input: { scope?: string }): Promise<string> {
  const supabase = createServiceClient()
  const today = new Date().toISOString().split("T")[0]
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]

  let query = supabase
    .from("reminders")
    .select("id, title, due_date, due_time, type, notes, customer_id, job_id")
    .is("completed_at", null)
    .order("due_date", { ascending: true })
    .limit(20)

  if (input.scope === "overdue") {
    query = query.lt("due_date", today)
  } else if (input.scope === "upcoming") {
    query = query.gte("due_date", today).lte("due_date", in7Days)
  } else {
    query = query.eq("due_date", today)
  }

  const { data, error } = await query
  if (error) return `Error looking up reminders: ${error.message}`
  if (!data?.length) return `No reminders found for scope "${input.scope ?? "today"}".`

  return data
    .map((r) => `id=${r.id} | "${r.title}" | due=${r.due_date}${r.due_time ? ` ${r.due_time}` : ""} | type=${r.type}${r.notes ? ` | notes=${r.notes}` : ""}`)
    .join("\n")
}

async function runListBankTransactions(input: { match_status?: string | null; search?: string | null; limit?: number | null }): Promise<string> {
  const supabase = createServiceClient()
  const limit = Math.min(50, Math.max(1, input.limit ?? 20))

  let query = supabase
    .from("bank_transactions")
    .select("id, amount, date, name, merchant_name, category, pending, match_status, bank_accounts(name, mask)")
    .order("date", { ascending: false })
    .limit(limit)

  if (input.match_status) query = query.eq("match_status", input.match_status)
  if (input.search) query = query.ilike("name", `%${input.search}%`)

  const { data, error } = await query
  if (error) return `Error looking up bank transactions: ${error.message}`
  if (!data?.length) return "No bank transactions found."

  return data
    .map((t) => {
      const account = Array.isArray(t.bank_accounts) ? t.bank_accounts[0] : t.bank_accounts
      const accountLabel = account ? `${account.name}${account.mask ? ` ••${account.mask}` : ""}` : "?"
      const direction = t.amount < 0 ? "money in" : "money out"
      return `id=${t.id} | ${t.date} | "${t.merchant_name ?? t.name}" | $${Math.abs(t.amount).toFixed(2)} (${direction}) | account=${accountLabel} | category=${t.category ?? "?"} | match_status=${t.match_status}${t.pending ? " | pending" : ""}`
    })
    .join("\n")
}

// ─── Claude call ──────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 3

export async function callLiaBrain(
  history: Array<{ role: string; content: string }>,
  crmContext: string,
  today: string,
): Promise<BrainResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { message: "Lia is not configured yet — ANTHROPIC_API_KEY is missing." }
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const messages: Anthropic.MessageParam[] = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const result = await anthropic.messages.create({
        model:      "claude-opus-5",
        max_tokens: 4096,
        thinking:   { type: "adaptive" },
        output_config: { effort: "high" },
        system:     buildSystemPrompt(crmContext, today),
        tools:      TOOLS,
        messages,
      })

      if (result.stop_reason === "refusal") {
        console.warn("[lia-brain] refusal:", JSON.stringify(result.stop_details ?? {}))
        return { message: "I can't help with that one — let's try something else." }
      }

      const replyText = result.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim()

      const toolUse = result.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

      if (!toolUse) {
        return { message: replyText || "..." }
      }

      console.log("[lia-brain] tool call:", toolUse.name, JSON.stringify(toolUse.input).slice(0, 300))

      if (READ_ONLY_TOOLS.has(toolUse.name)) {
        const toolResultText = toolUse.name === "list_bank_transactions"
          ? await runListBankTransactions(toolUse.input as { match_status?: string | null; search?: string | null; limit?: number | null })
          : await runListReminders(toolUse.input as { scope?: string })
        messages.push({ role: "assistant", content: result.content })
        messages.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: toolUse.id, content: toolResultText }],
        })
        continue
      }

      // Write tool — this tool call IS the proposed action. Stop and hand it
      // back for approval; nothing executes here.
      const { summary, ...rest } = toolUse.input as Record<string, unknown> & { summary?: string }
      return {
        message: replyText || (summary as string) || "Here's what I'd like to do:",
        action: {
          type:       toolUse.name,
          summary:    (summary as string) ?? toolUse.name,
          payload:    rest,
          risk_level: ACTION_RISK[toolUse.name] ?? "low",
        },
      }
    }

    return { message: "I looked into that but need a bit more info — could you clarify what you'd like me to do?" }
  } catch (err) {
    console.error("[lia-brain] error:", err)
    return { message: "I hit a problem reaching Claude just now — please try again in a moment." }
  }
}
