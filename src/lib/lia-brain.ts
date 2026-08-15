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
import { EXPENSE_CATEGORIES } from "@/lib/expense-categories"
import { listUpcomingEvents } from "@/lib/google-calendar"

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

APPROVAL-FIRST RULE: You never execute anything directly. When a tool call would change data (create, update, complete, record — anything but looking something up), that tool call is only a *proposal* — the human always sees an approve/reject/edit card first, and nothing happens until they approve it. \`list_reminders\`, \`list_bank_transactions\`, and \`query_crm\` are lookups — call them freely, as many times as needed, to answer questions.

BANK TRANSACTIONS: You can see connected bank accounts' transactions via list_bank_transactions. If one clearly matches an expense or payment the user is describing (same amount, close date), mention it and set bank_transaction_id on the create_expense/record_payment proposal so it gets linked — but only when you're confident, and always let the user correct it via the approval card.

GROUP CHAT: Some conversations are a shared group chat with multiple team members talking to you in one thread. When that's the case, user messages are prefixed with the sender's name (e.g. "Edan: can you...") so you know who said what — use that to keep track of who's asking, but never include that prefix format in your own replies, and don't confuse one person's earlier statement for another's.

STYLE: Be concise — 1 to 3 sentences unless the user asks for detail. Sound like a sharp, competent teammate texting back, not a form. Never say "I cannot do that" for anything in your toolset — instead propose the action or ask exactly one focused follow-up question if something required is missing.

RULES:
- Always use real UUIDs copied from CRM CONTEXT below — never invent an id, phone number, date, or address. If someone isn't in CRM CONTEXT, don't guess an id for them — either ask the user to add them first, or use create_customer.
- A job's title should be the property's street address whenever one is known (e.g. "82388 Odlum Dr"), never a service description like "Pavers" — that convention is enforced elsewhere in the CRM too, so follow it when you set or change a job's title.
- Do not invent brands, measurements, warranties, or anything the user did not specify.
- Before proposing create_lead_appointment, check LEAD APPOINTMENTS in CRM CONTEXT — if the same customer already has one within 7 days of the requested date, mention that in your message, but still propose the action so the user can decide.
- "Add/schedule X for [day/time]" does NOT require X to already exist as a formal customer — that's normal, most people asked about this way are brand new. Never respond with anything like "no customer found" for a person who just isn't in the system yet. Instead: (1) query_crm(meta_leads, full_name search for their name) — if they're already on a Meta Lead call list, use update_meta_lead_outcome (answered_scheduled) instead, which correctly moves them off the call list too; (2) if not found there or anywhere else, just use create_lead_appointment — it's built for exactly this, a brand new person with no existing record.
- If the user asks to cancel or change a pending approval, tell them to reject the card, then re-describe what they want.
- If you're just greeting, chatting, or answering a question with no data-changing intent, reply naturally with no tool call at all.

DATA ACCESS: CRM CONTEXT below is only a small recent-activity snapshot (customers, jobs, lead appointments) — it is NOT everything in the CRM. You have a lot more data than that: meta lead call lists, PropStream leads, estimates, invoices, payments, expenses, reminders, sent contracts, change orders, bank transactions, and team members. Never say you don't have access to something or can't check — call query_crm (as many times as needed) to look it up for real before answering. This applies to any "how many", "list", "who/what/when" question about CRM data, not just the tables shown in CRM CONTEXT.

You also have full read access to the real Google Calendar via list_calendar_events — not just what's in the database. Use it to check for a scheduling conflict before proposing a new appointment/call, and to answer any "what's coming up" / "do we have anything near [date]" question directly instead of guessing from CRM CONTEXT alone.

EDITING EXISTING RECORDS: Don't say "I can't edit that" or "I don't have a tool for that." For a specific, well-understood action (reschedule a job, log a payment, mark a call outcome), use the dedicated tool. For anything else — renaming/correcting a field on one record, or the same change across many ("rename every Facebook-related expense's description to 'Facebook Advertising'") — use update_crm_records. Always query_crm first (count_only for bulk) so your proposal message tells the user exactly how many records and what's changing before they approve it.

CREATING MULTIPLE THINGS AT ONCE: A tool call only ever proposes ONE approval per turn — if you call create_expense multiple times, only the first one becomes a real proposal and the rest silently vanish. So whenever a request needs more than one new expense (catching up on several bank transactions, a batch of receipts, "insert all the new charges from last week"), use bulk_create_expenses instead — one array, one approval, one approve click creates all of them. Never call create_expense more than once in the same turn.

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

// Read-only surface for query_crm — one entry per table Lia can look up.
// `columns` is a hand-picked safe select list (never exposes credentials —
// e.g. plaid_items.access_token is deliberately not queryable at all).
// `filterable` bounds what query_crm will accept in `filters` to plain
// exact-match `.eq()` calls, so this can never become arbitrary SQL.
// `filterable` = exact match (.eq) — enum-like fields (status, category, type).
// `searchable` = case-insensitive substring match (.ilike) — free-text fields
// (description, name, vendor) where "find every expense with 'facebook ads'
// in the description" needs to match partial text, not an exact string.
const QUERYABLE_TABLES: Record<string, { columns: string; filterable: string[]; searchable?: string[]; orderBy: string }> = {
  customers:         { columns: "id, name, phone, email, address, service_type, lead_source, status, created_at", filterable: ["status", "lead_source"], searchable: ["name", "email", "phone"], orderBy: "created_at" },
  jobs:              { columns: "id, title, status, scheduled_date, completion_date, customer_id, created_at", filterable: ["status"], searchable: ["title"], orderBy: "scheduled_date" },
  estimates:         { columns: "id, title, status, total, customer_id, sent_at, approved_at, created_at", filterable: ["status"], searchable: ["title"], orderBy: "created_at" },
  invoices:          { columns: "id, type, status, amount, due_date, job_id, customer_id, created_at", filterable: ["status", "type"], orderBy: "due_date" },
  payments:          { columns: "id, amount, method, date, job_id, customer_id", filterable: ["method"], orderBy: "date" },
  expenses:          { columns: "id, category, description, amount, date, job_id", filterable: ["category"], searchable: ["description"], orderBy: "date" },
  reminders:         { columns: "id, title, due_date, due_time, type, completed_at, customer_id, job_id", filterable: ["type"], searchable: ["title"], orderBy: "due_date" },
  meta_leads:        { columns: "id, full_name, phone, city, list, last_outcome, missed_call_count, scheduled_at, created_at", filterable: ["list", "last_outcome"], searchable: ["full_name", "city"], orderBy: "created_at" },
  propstream_leads:  { columns: "id, owner_name, property_address, property_city, status, next_follow_up_at, created_at", filterable: ["status"], searchable: ["owner_name", "property_address"], orderBy: "created_at" },
  sent_contracts:    { columns: "id, customer_id, job_id, recipient_email, status, signed_at, sent_at", filterable: ["status"], orderBy: "sent_at" },
  change_orders:     { columns: "id, job_id, customer_id, title, amount, status, sent_at, approved_at, created_at", filterable: ["status"], searchable: ["title"], orderBy: "created_at" },
  bank_transactions: { columns: "id, amount, date, name, merchant_name, category, match_status", filterable: ["match_status"], searchable: ["name", "merchant_name"], orderBy: "date" },
  team_members:      { columns: "id, name, email, role, status", filterable: ["role", "status"], searchable: ["name", "email"], orderBy: "created_at" },
}
// Which fields update_crm_records is allowed to touch, per table — always a
// SUBSET of that table's columns, deliberately excluding anything with real
// business logic behind it (money fields, and statuses that drive side
// effects like invoice paid/partial math or job completion) — those stay on
// their dedicated tools (update_job, record_payment, etc.) which get that
// logic right. "id" is always a valid filter key in addition to the lists
// below. `searchable` fields match as a substring (.ilike), same as above.
export const EDITABLE_TABLES: Record<string, { editable: string[]; filterable: string[]; searchable?: string[] }> = {
  customers:  { editable: ["name", "phone", "email", "address", "service_type", "lead_source", "status", "notes"], filterable: ["status", "lead_source"], searchable: ["name", "email", "phone"] },
  jobs:       { editable: ["title", "description"], filterable: ["status"], searchable: ["title"] },
  expenses:   { editable: ["category", "description", "date", "job_id", "expense_type"], filterable: ["category", "expense_type"], searchable: ["description"] },
  payments:   { editable: ["notes", "method"], filterable: ["method"] },
  reminders:  { editable: ["title", "due_date", "due_time", "type", "notes"], filterable: ["type"], searchable: ["title"] },
  invoices:   { editable: ["notes"], filterable: ["status", "type"] },
  meta_leads: { editable: ["notes", "city", "email", "phone", "full_name"], filterable: ["list", "last_outcome"], searchable: ["full_name", "city"] },
  change_orders: { editable: ["notes", "title", "description"], filterable: ["status"], searchable: ["title"] },
}

// The orderBy column doubles as each table's primary date field for
// date_from/date_to range filtering (e.g. "how much did we spend today").

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
        category:            { type: "string", enum: [...EXPENSE_CATEGORIES] },
        date:                { type: "string", description: "YYYY-MM-DD, use today if not specified" },
        notes:               { type: ["string", "null"] },
        job_id:              { type: ["string", "null"], description: "Only if the user names a specific job from CRM CONTEXT." },
        bank_transaction_id: { type: ["string", "null"], description: "Set only when this expense matches a specific bank transaction surfaced by list_bank_transactions — links them together." },
      },
      required: ["summary", "amount", "category", "date"],
    },
  },
  {
    name: "bulk_create_expenses",
    description: "Record MULTIPLE expenses at once as a SINGLE approval — use this instead of calling create_expense repeatedly whenever more than one expense is being added in the same request (catching up on a batch of bank transactions, several receipts at once, etc.). One card, one approve click creates the whole batch. Look up candidates via query_crm/list_bank_transactions first so every item has real data — never invent amounts or dates.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        expenses: {
          type: "array",
          description: "One entry per expense.",
          items: {
            type: "object",
            properties: {
              amount:              { type: "number" },
              vendor:              { type: ["string", "null"] },
              category:            { type: "string", enum: [...EXPENSE_CATEGORIES] },
              date:                { type: "string", description: "YYYY-MM-DD" },
              notes:               { type: ["string", "null"] },
              job_id:              { type: ["string", "null"] },
              bank_transaction_id: { type: ["string", "null"], description: "Set when this item matches a specific bank transaction — links them and prevents re-proposing it later." },
            },
            required: ["amount", "category", "date"],
          },
        },
      },
      required: ["summary", "expenses"],
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
    name: "query_crm",
    description: `Look up records from anywhere in the CRM — read-only, does not need approval, call it as many times as needed in one turn (in parallel is fine). Use this for ANY factual question you can't already answer from CRM CONTEXT: counts ("how many on the call list"), totals ("how much did we spend today"), lists ("which invoices are unpaid"), lookups by status, etc. Never say you don't have access — query instead.

Tables you can query: ${Object.keys(QUERYABLE_TABLES).join(", ")}.
Set count_only=true for "how many" questions — much cheaper than listing rows. For sums ("how much money"), list the rows (not count_only) and add up the amount field yourself.
For date-range questions ("today", "this week"), use date_from/date_to — each table's most relevant date field is used automatically (jobs→scheduled_date, expenses/payments/bank_transactions→date, invoices/reminders→due_date, meta_leads/estimates/change_orders→created_at, sent_contracts→sent_at). For "today" set both to the same date.
Filters: enum-like fields (status, category, type, ...) match exactly. Free-text fields (description, name, title, ...) match as a case-insensitive substring — e.g. {"description": "facebook"} matches "Facebook Ads 5/7", "FACEBOOK ADS", etc.`,
    input_schema: {
      type: "object",
      properties: {
        table:      { type: "string", enum: Object.keys(QUERYABLE_TABLES), description: "Which table to query." },
        filters:    { type: ["object", "null"], description: "Filters as {field: value} — exact match for enum-like fields, substring match for free-text fields (see tool description). Only use fields that table actually has." },
        date_from:  { type: ["string", "null"], description: "YYYY-MM-DD, inclusive lower bound on that table's date field." },
        date_to:    { type: ["string", "null"], description: "YYYY-MM-DD, inclusive upper bound on that table's date field." },
        count_only: { type: ["boolean", "null"], description: "true = just return the count, not the rows. Use for \"how many\" questions." },
        limit:      { type: ["number", "null"], description: "Max rows when not count_only. Defaults to 20, max 50." },
      },
      required: ["table"],
    },
  },
  {
    name: "update_crm_records",
    description: `Edit one or more EXISTING records anywhere in the CRM — single record (filter by id) or bulk (filter by a shared field, e.g. rename every "marketing" expense's description). Always requires approval, same as every other write tool here — for a bulk change, ALWAYS call query_crm with the same filters and count_only=true FIRST so your message tells the user how many records will change before they approve it.

Tables and their editable fields: ${Object.entries(EDITABLE_TABLES).map(([t, c]) => `${t} (${c.editable.join(", ")})`).join("; ")}.
Money fields (amount/total/price) and workflow statuses (job status, invoice status, etc.) are deliberately NOT editable here — use the dedicated tool for those (update_job, record_payment, update_meta_lead_outcome, ...) since they carry logic this generic tool doesn't.
Filters: enum-like fields (status, category, type, ...) match exactly; free-text fields (description, name, title, ...) match as a case-insensitive substring, same as query_crm — use query_crm first to confirm your filter actually matches what you expect before proposing the edit.`,
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        table:   { type: "string", enum: Object.keys(EDITABLE_TABLES), description: "Which table to update." },
        filters: { type: "object", description: "Which rows to update, as {field: value}. Use {\"id\": \"...\"} for one specific record, exact match for enum-like fields, or substring match for free-text fields. Must not be empty — never update a whole table unfiltered." },
        updates: { type: "object", description: "Fields to change, as {field: new_value} — only fields from that table's editable list." },
      },
      required: ["summary", "table", "filters", "updates"],
    },
  },
  {
    name: "update_meta_lead_outcome",
    description: "Log the outcome of a call to someone on the Meta Leads call list (query_crm table=meta_leads to find them). Mirrors the outcome buttons on the Meta Lead Jobs page: no_answer moves them to the second call list (or auto-archives at 10 missed calls — mention this if their missed_call_count from query_crm is close), answered_scheduled books the main appointment calendar, callback_later books the callback calendar and moves them to the callback list.",
    input_schema: {
      type: "object",
      properties: {
        ...SUMMARY_PROP,
        meta_lead_id: { type: "string", description: "From query_crm." },
        full_name:    { type: "string", description: "For display only." },
        outcome:      { type: "string", enum: ["answered_scheduled", "no_answer", "callback_later"] },
        scheduled_at: { type: ["string", "null"], description: "ISO 8601 datetime — required for answered_scheduled and callback_later, omit for no_answer." },
      },
      required: ["summary", "meta_lead_id", "full_name", "outcome"],
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
  {
    name: "list_calendar_events",
    description: "Look up what's actually on the Google Calendar — read-only, does not need approval. Use this to check for a conflict before proposing a new appointment, to answer \"what's coming up\" / \"do we have anything near [date]\", or to find an event's id. Covers both the main calendar and the callback calendar.",
    input_schema: {
      type: "object",
      properties: {
        calendar:    { type: ["string", "null"], enum: ["main", "callback", "both", null], description: "Which calendar to check. Defaults to \"both\"." },
        days_ahead:  { type: ["number", "null"], description: "How many days out to look, starting now. Defaults to 14." },
      },
      required: [],
    },
  },
]

const READ_ONLY_TOOLS = new Set(["list_reminders", "list_bank_transactions", "query_crm", "list_calendar_events"])

const ACTION_RISK: Record<string, "low" | "medium" | "high"> = {
  create_send_invoice:  "medium",
  record_payment:       "medium",
  update_crm_records:   "medium",
  bulk_create_expenses: "medium",
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

async function runQueryCrm(input: { table?: string; filters?: Record<string, string> | null; date_from?: string | null; date_to?: string | null; count_only?: boolean | null; limit?: number | null }): Promise<string> {
  const table  = input.table ?? ""
  const config = QUERYABLE_TABLES[table]
  if (!config) {
    return `Unknown table "${table}". Valid tables: ${Object.keys(QUERYABLE_TABLES).join(", ")}.`
  }

  for (const key of Object.keys(input.filters ?? {})) {
    if (!config.filterable.includes(key) && !(config.searchable ?? []).includes(key)) {
      const allowed = [...config.filterable, ...(config.searchable ?? [])]
      return `Cannot filter "${table}" by "${key}". Allowed fields for ${table}: ${allowed.join(", ") || "(none)"}.`
    }
  }

  const supabase = createServiceClient()
  const descParts = [
    input.filters && Object.keys(input.filters).length ? `matching ${JSON.stringify(input.filters)}` : null,
    input.date_from || input.date_to ? `between ${input.date_from ?? "…"} and ${input.date_to ?? "…"} (by ${config.orderBy})` : null,
  ].filter(Boolean)
  const filterDesc = descParts.length ? ` ${descParts.join(" ")}` : ""

  const applyFilters = (q: ReturnType<ReturnType<typeof createServiceClient>["from"]>["select"] extends (...a: never[]) => infer R ? R : never) => {
    for (const [key, value] of Object.entries(input.filters ?? {})) {
      q = (config.searchable ?? []).includes(key) ? q.ilike(key, `%${value}%`) : q.eq(key, value)
    }
    if (input.date_from) q = q.gte(config.orderBy, input.date_from)
    if (input.date_to)   q = q.lte(config.orderBy, input.date_to)
    return q
  }

  if (input.count_only) {
    const { count, error } = await applyFilters(supabase.from(table).select("id", { count: "exact", head: true }))
    if (error) return `Error querying ${table}: ${error.message}`
    return `${count ?? 0} row(s) in ${table}${filterDesc}.`
  }

  const limit = Math.min(50, Math.max(1, input.limit ?? 20))
  const { data, error } = await applyFilters(supabase.from(table).select(config.columns))
    .order(config.orderBy, { ascending: false })
    .limit(limit)

  if (error) return `Error querying ${table}: ${error.message}`
  if (!data?.length) return `No rows found in ${table}${filterDesc}.`
  return data.map((row) => JSON.stringify(row)).join("\n")
}

async function runListCalendarEvents(input: { calendar?: string | null; days_ahead?: number | null }): Promise<string> {
  const which = input.calendar ?? "both"
  const targets: Array<{ label: string; id: string | undefined }> = []
  if (which === "main" || which === "both")     targets.push({ label: "Main",     id: process.env.META_LEADS_MAIN_CALENDAR_ID })
  if (which === "callback" || which === "both") targets.push({ label: "Callback", id: process.env.META_LEADS_CALLBACK_CALENDAR_ID })

  const configured = targets.filter((t) => t.id)
  if (!configured.length) return "No calendar is configured (META_LEADS_MAIN_CALENDAR_ID / META_LEADS_CALLBACK_CALENDAR_ID)."

  const lines: string[] = []
  for (const t of configured) {
    try {
      const events = await listUpcomingEvents(t.id!, { daysAhead: input.days_ahead ?? 14 })
      if (!events.length) {
        lines.push(`${t.label} calendar: nothing in this window.`)
        continue
      }
      lines.push(`${t.label} calendar:`)
      for (const e of events) {
        lines.push(`  id=${e.id} | "${e.title}" | ${e.start ?? "?"} – ${e.end ?? "?"}${e.location ? ` | ${e.location}` : ""}`)
      }
    } catch (err) {
      lines.push(`${t.label} calendar: error — ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return lines.join("\n")
}

// ─── Claude call ──────────────────────────────────────────────────────────────

const MAX_TOOL_ITERATIONS = 5

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

      // Claude can (and does) call more than one tool in a single response
      // (e.g. two query_crm lookups at once) — every tool_use block here
      // MUST get a matching tool_result before the next API call, or the
      // request 400s on the very next turn ("tool_use ids were found
      // without tool_result blocks"). Grabbing only the first with .find()
      // silently dropped the rest and corrupted the transcript.
      const toolUses = result.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")

      if (!toolUses.length) {
        return { message: replyText || "..." }
      }

      for (const t of toolUses) {
        console.log("[lia-brain] tool call:", t.name, JSON.stringify(t.input).slice(0, 300))
      }

      const writeTool = toolUses.find((t) => !READ_ONLY_TOOLS.has(t.name))

      if (!writeTool) {
        // All read-only — resolve every one, then continue the loop.
        const toolResults = await Promise.all(toolUses.map(async (t) => {
          const text =
            t.name === "list_bank_transactions" ? await runListBankTransactions(t.input as { match_status?: string | null; search?: string | null; limit?: number | null }) :
            t.name === "query_crm"              ? await runQueryCrm(t.input as { table?: string; filters?: Record<string, string> | null; date_from?: string | null; date_to?: string | null; count_only?: boolean | null; limit?: number | null }) :
            t.name === "list_calendar_events"   ? await runListCalendarEvents(t.input as { calendar?: string | null; days_ahead?: number | null }) :
            await runListReminders(t.input as { scope?: string })
          return { type: "tool_result" as const, tool_use_id: t.id, content: text }
        }))
        messages.push({ role: "assistant", content: result.content })
        messages.push({ role: "user", content: toolResults })
        continue
      }

      // Write tool — this tool call IS the proposed action. Stop and hand it
      // back for approval; nothing executes here. Any other tool_use blocks
      // in this same response are discarded — safe, since `messages` is
      // never sent to the API again after we return.
      const { summary, ...rest } = writeTool.input as Record<string, unknown> & { summary?: string }
      return {
        message: replyText || (summary as string) || "Here's what I'd like to do:",
        action: {
          type:       writeTool.name,
          summary:    (summary as string) ?? writeTool.name,
          payload:    rest,
          risk_level: ACTION_RISK[writeTool.name] ?? "low",
        },
      }
    }

    return { message: "I looked into that but need a bit more info — could you clarify what you'd like me to do?" }
  } catch (err) {
    console.error("[lia-brain] error:", err)
    return { message: "I hit a problem reaching Claude just now — please try again in a moment." }
  }
}
