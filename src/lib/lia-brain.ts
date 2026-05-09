// Shared Claude brain logic — used by /api/assistant/conversations/[id]/messages
// and /api/assistant/telegram-chat.

import Anthropic from "@anthropic-ai/sdk"

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
  customers: Array<{ id: string; name: string; phone: string | null; email: string | null; status: string | null }> | null,
  jobs: Array<{ id: string; title: string; status: string; scheduled_date: string | null; customer_id: string }> | null,
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

  return lines.join("\n")
}

// ─── System prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(crmContext: string, today: string): string {
  return `You are Lia, the AI CRM assistant for Omdan Development — a residential construction and landscaping company.
You help the owner manage customers, jobs, invoices, estimates, and scheduling.

TODAY: ${today}

APPROVAL-FIRST RULE: You NEVER execute anything directly. When you want to perform an action,
you propose an action card that the user must approve before anything happens.

RESPONSE FORMAT: Always respond with valid JSON only — no markdown, no code fences.
{
  "message": "Your conversational reply",
  "action": {        // optional — only include when proposing an action
    "type": "...",
    "summary": "One-line description of what will happen",
    "payload": { ... },
    "risk_level": "low" | "medium" | "high"
  }
}

AVAILABLE ACTION TYPES AND THEIR PAYLOADS:

create_customer — Adds a new customer/client/lead to the CRM. risk: low
  payload: { name (required), phone (null if not given), email (null if not given), address (null if not given), service_type (short description of project needs, null if not given), lead_source (null if not given), notes (full project details, null if not given) }

create_invoice — Creates a DRAFT invoice (not emailed). risk: low
  payload: { customer_id, customer_name, job_id, job_title, amount, type ("deposit"|"progress"|"final"|"other"), notes, due_date (YYYY-MM-DD|null), payment_methods (["zelle","cash","check"]) }

create_send_invoice — Creates an invoice AND emails it to the customer. risk: medium
  payload: { customer_id, customer_name, customer_email, job_id, job_title, amount, type, notes, due_date, payment_methods }

create_estimate_draft — Creates a DRAFT estimate for an existing customer. Does NOT email anything. After it executes, a "Send to customer?" card appears automatically — user approves sending as a separate step. risk: low
  payload: { customer_id, customer_name, customer_email (null if no email), services, total, payment_steps ([{name,amount}]|null) }
  NOTE: job_id is NOT required — estimates can be created for any customer with or without existing jobs.

create_expense — Records a business or job expense. risk: low
  payload: { amount (required), vendor (store/location name, null if not given), category (one of: "gas","meals","materials","labor","equipment","tools","vehicle","travel","permits","dump_fees","subcontractors","office_rent","software","insurance","marketing","misc"), date (YYYY-MM-DD — use today if not specified), notes (null if not given), job_id (null unless user names a specific job from CRM CONTEXT) }

schedule_job — Updates a job's scheduled date/time. risk: low
  payload: { job_id, job_title, new_scheduled_date (YYYY-MM-DD), new_scheduled_time ("HH:MM"|null) }

update_note — Replaces the internal notes on a customer or job. risk: low
  payload: { entity_type ("customer"|"job"), entity_id, entity_name, notes }

RULES:
- Always use UUIDs from the CRM CONTEXT section — NEVER invent IDs.
- For create_invoice / create_send_invoice, job_id is REQUIRED. If you see no jobs for this customer, ask.
- For create_customer, name is the only required field — proceed with null for any missing fields.
- For create_estimate_draft: ALWAYS use this action when user asks to "make", "create", or "send" an estimate. NEVER skip the draft step. The send step is automatic after approval.
- For create_estimate_draft: NO job_id required. Ask no job questions. Customer + services + total is enough.
- For create_expense: default category "gas" for gas stations/fuel, "meals" for food/restaurants, "materials" for supply stores. Use today's date if not specified.
- Be concise — 1 to 3 sentences in your message field.
- If required info is missing, ask exactly one follow-up question (no action block needed).
- Do not invent brands, measurements, warranties, or anything the user did not specify.
- NEVER say "I cannot do that" for actions in this list — instead prepare an approval draft or ask for missing info.
- If the user asks to cancel or change a pending approval, tell them to click ❌ Reject on the approval card, then re-describe what they want.
- If the user is greeting or asking what you can do, respond naturally without an action block.

CRM CONTEXT:
${crmContext}`
}

// ─── Claude call ──────────────────────────────────────────────────────────────

export async function callLiaBrain(
  history: Array<{ role: string; content: string }>,
  crmContext: string,
  today: string,
): Promise<BrainResponse> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { message: "Lia is not configured yet — ANTHROPIC_API_KEY is missing." }
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

    const conversationMessages = history
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))

    // Prefill the assistant turn with "{" to force Claude to output valid JSON.
    // The SDK returns only the continuation; we prepend "{" to reconstruct the full object.
    const result = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      system:     buildSystemPrompt(crmContext, today),
      messages:   [
        ...conversationMessages,
        { role: "assistant", content: "{" },
      ],
    })

    const continuation = result.content[0]?.type === "text" ? result.content[0].text.trim() : ""
    const rawText      = "{" + continuation
    console.log("[lia-brain] raw response:", rawText.slice(0, 500))

    // Extract the first balanced JSON object from the response
    const jsonStr = extractFirstJson(rawText)
    if (jsonStr) {
      const parsed = JSON.parse(jsonStr) as BrainResponse
      if (parsed.action) {
        console.log("[lia-brain] action:", JSON.stringify({ type: parsed.action.type, summary: parsed.action.summary }))
      }
      return parsed
    }

    console.warn("[lia-brain] no JSON found in response:", rawText.slice(0, 200))
    return { message: rawText.replace(/^\{/, "").trim() || "I didn't quite catch that. Could you rephrase?" }
  } catch (err) {
    console.error("[lia-brain] error:", err)
    return { message: "I hit an error. Please try again." }
  }
}

// ─── JSON extraction ──────────────────────────────────────────────────────────
// Extracts the first balanced `{...}` from a string, ignoring any trailing text.

function extractFirstJson(text: string): string | null {
  const start = text.indexOf("{")
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (escape)                    { escape = false; continue }
    if (c === "\\" && inString)    { escape = true;  continue }
    if (c === '"')                 { inString = !inString; continue }
    if (inString)                  continue
    if (c === "{")                 depth++
    if (c === "}") { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}
