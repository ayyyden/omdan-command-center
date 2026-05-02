import "dotenv/config"
import express, { type Request, type Response } from "express"
import { startScheduler }           from "./scheduler"
import { parseIntent }              from "./intent-parser"
import { parseInvoiceMessage }      from "./invoice-parser"
import { parseLeadEstimateMessage } from "./lead-parser"
import { parseScheduleMessage, formatScheduledDate, formatScheduledTime } from "./schedule-parser"
import { parseContractMessage } from "./contract-parser"
import { formatDailySummary }       from "./format-response"
import { sendWhatsAppText }         from "./openclaw-client"
import { sendTelegramMessage, sendTelegramWithButtons, type InlineKeyboardButton } from "./telegram-client"
import { checkHealth, sendMessage, updateApproval, executeApproval } from "./crm-client"
import type { IncomingWebhook, EstimatePreview, LeadData, EstimateData, InvoiceData, InvoicePreview, CustomerMatch, JobMatch, ScheduleData, SchedulePreview, ContractData, ContractTemplate, ContractPreview, CrmMessageResponse } from "./types"

// ─── Config ───────────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3001", 10)

const ALLOWED_NUMBERS: string[] = (process.env.LIA_ALLOWED_WHATSAPP_NUMBERS ?? "")
  .split(",")
  .map(n => n.trim().replace(/[^0-9]/g, ""))
  .filter(Boolean)

function isAllowed(from: string): boolean {
  const normalized = from.replace(/@.*$/, "").replace(/[^0-9]/g, "")
  return ALLOWED_NUMBERS.includes(normalized)
}

const TELEGRAM_ALLOWED_IDS: Set<number> = new Set(
  (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map(id => parseInt(id.trim(), 10))
    .filter(id => !isNaN(id))
)

// ─── Pending edit state ────────────────────────────────────────────────────────
// Key = chatId (Telegram) or phone number (WhatsApp), value = old approval to reject.

const pendingEdits = new Map<string, { oldApprovalId: string }>()

// ─── Pending customer disambiguation (invoice flow) ───────────────────────────
// Stores parsed invoice data while waiting for the user to pick a customer.

const pendingInvoicePicks = new Map<string, {
  parsedText:  string
  invoiceData: InvoiceData
  matches:     CustomerMatch[]
}>()

// ─── Pending job disambiguation (invoice flow) ────────────────────────────────
// Stores resolved invoice data while waiting for the user to pick a job.

const pendingJobPicks = new Map<string, {
  invoiceData: InvoiceData
  matches:     JobMatch[]
}>()

// ─── Pending schedule disambiguation ─────────────────────────────────────────
// Stores partial schedule data while waiting for customer or job selection.

const pendingScheduleCustomerPicks = new Map<string, {
  scheduleData: ScheduleData
  matches:      CustomerMatch[]
}>()

const pendingScheduleJobPicks = new Map<string, {
  scheduleData: ScheduleData
  matches:      JobMatch[]
}>()

// ─── Pending contract disambiguation ─────────────────────────────────────────

const pendingContractCustomerPicks = new Map<string, {
  contractData: ContractData
  matches:      CustomerMatch[]
}>()

const pendingContractJobPicks = new Map<string, {
  contractData: ContractData
  matches:      JobMatch[]
}>()

const pendingContractTemplatePicks = new Map<string, {
  contractData: ContractData
  templates:    ContractTemplate[]
}>()

// ─── Formatters ───────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return `$${Number(n).toLocaleString("en-US")}`
}

function formatLeadPreview(
  approvalId: string,
  lead: LeadData,
  estimate: EstimateData | null | undefined,
  wantsEstimate: boolean,
): string {
  const lines = ["📋 New Lead — Pending Approval", ""]
  lines.push(`👤 Customer: ${lead.name ?? "Unknown"}`)
  if (lead.phone)        lines.push(`📞 Phone: ${lead.phone}`)
  if (lead.email)        lines.push(`📧 Email: ${lead.email}`)
  if (lead.service_type) lines.push(`🛠 Services: ${lead.service_type}`)

  if (wantsEstimate && estimate?.total) {
    lines.push(`💰 Estimate Total: ${fmtMoney(estimate.total)}`)
    if (estimate.payment_steps?.length) {
      lines.push("", "Payment Schedule:")
      for (const s of estimate.payment_steps) {
        lines.push(`  • ${s.name}: ${fmtMoney(s.amount)}`)
      }
    }
  }

  lines.push("", `ID: ${approvalId}`)
  return lines.join("\n")
}

function formatEstimatePreview(sendApprovalId: string, preview: EstimatePreview): string {
  const lines = ["✅ Lead created — Draft Estimate Ready", ""]
  lines.push(`📋 ${preview.title}`)
  lines.push(`💰 Total: ${fmtMoney(preview.total)}`)

  if (preview.scope) {
    lines.push("", `📝 Scope: ${preview.scope}`)
  } else if (preview.services) {
    lines.push(`🛠 Services: ${preview.services}`)
  }

  if (preview.payment_steps?.length) {
    lines.push("", "Payment Schedule:")
    for (const s of preview.payment_steps) {
      lines.push(`  • ${s.name}: ${fmtMoney(s.amount)}`)
    }
  }

  if (preview.email) lines.push("", `📧 Send to: ${preview.email}`)
  if (preview.estimate_url) lines.push(`🔗 CRM: ${preview.estimate_url}`)

  lines.push("", "📎 PDF will be attached to the customer email.")
  lines.push("", `ID: ${sendApprovalId}`)
  return lines.join("\n")
}

// ─── Invoice preview formatter ────────────────────────────────────────────────

function formatInvoicePreview(approvalId: string, preview: InvoicePreview): string {
  const METHOD_LABELS: Record<string, string> = { zelle: "Zelle", cash: "Cash", check: "Check", venmo: "Venmo" }
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  const lines = ["📋 Invoice — Pending Approval", ""]
  lines.push(`👤 Customer: ${preview.customer_name}`)
  if (preview.customer_email) lines.push(`📧 Send to: ${preview.customer_email}`)
  if (preview.job_title)      lines.push(`🔨 Job: ${preview.job_title}`)
  lines.push(`💰 Amount: ${fmtMoney(preview.amount)}`)
  lines.push(`📂 Type: ${preview.type_label}`)
  if (preview.due_date) {
    try {
      const d = new Date(preview.due_date + "T00:00:00")
      lines.push(`📅 Due: ${d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`)
    } catch { lines.push(`📅 Due: ${preview.due_date}`) }
  }
  if (preview.notes) lines.push(`📝 Note: ${preview.notes}`)
  if (preview.payment_methods.length) {
    lines.push(`💳 Payment: ${preview.payment_methods.map((m) => METHOD_LABELS[m] ?? cap(m)).join(", ")}`)
  }
  if (!preview.customer_email) {
    lines.push("", "⚠️ No email on file — invoice will be created but not emailed.")
  }
  lines.push("", `ID: ${approvalId}`)
  return lines.join("\n")
}

// ─── Schedule preview formatter ──────────────────────────────────────────────

function formatSchedulePreview(approvalId: string, preview: SchedulePreview): string {
  const lines = ["📅 Schedule Job — Pending Approval", ""]
  lines.push(`👤 Customer: ${preview.customer_name}`)
  if (preview.customer_address) lines.push(`📍 Address: ${preview.customer_address}`)
  lines.push(`🔨 Job: ${preview.job_title}`)
  lines.push(`📊 Status: ${preview.job_status.replace(/_/g, " ")}`)

  if (preview.current_scheduled_date) {
    const curDate = formatScheduledDate(preview.current_scheduled_date)
    const curTime = formatScheduledTime(preview.current_scheduled_time)
    lines.push(``, `Current: ${curDate}${preview.current_scheduled_time ? ` at ${curTime}` : ""}`)
  }

  const newDate = formatScheduledDate(preview.new_scheduled_date)
  const newTime = formatScheduledTime(preview.new_scheduled_time)
  lines.push(`→ New: ${newDate} at ${newTime}`)

  if (preview.pm_name) lines.push(``, `👷 PM: ${preview.pm_name}`)
  if (preview.crm_url) lines.push(`🔗 CRM: ${preview.crm_url}`)
  lines.push(``, `ID: ${approvalId}`)
  return lines.join("\n")
}

// ─── Shared schedule handler ──────────────────────────────────────────────────

async function handleScheduleJob(
  rawText:   string,
  senderKey: string,
  send:      SendFn,
): Promise<void> {
  const parsed = parseScheduleMessage(rawText)

  if (parsed.missing.length > 0) {
    await send(
      `To schedule the job, I still need: ${parsed.missing.join(", ")}.\n\n` +
      `Example: "Lia, schedule John Smith paver job for Monday at 9am"`,
    )
    return
  }

  const scheduleData: ScheduleData = {
    customer_name:  parsed.customer_name  ?? undefined,
    job_title_hint: parsed.job_title_hint ?? undefined,
    scheduled_date: parsed.scheduled_date!,
    scheduled_time: parsed.scheduled_time ?? null,
  }

  const result = await sendMessage({
    message:       rawText,
    sender:        senderKey,
    intent:        "schedule_job",
    schedule_data: scheduleData,
  })

  if (result.missing_fields?.length) {
    await send(`To schedule the job, I still need: ${result.missing_fields.join(", ")}.`)
    return
  }

  if (result.not_found) {
    await send(result.response_text ?? "No customer or job found. Check the name and try again.")
    return
  }

  if (result.no_jobs) {
    await send(result.response_text ?? "No active jobs found for this customer.")
    return
  }

  // Customer disambiguation
  if (result.needs_customer_disambiguation && result.customer_matches?.length) {
    pendingScheduleCustomerPicks.set(senderKey, { scheduleData, matches: result.customer_matches })
    const lines = ["Multiple customers found — choose one:"]
    const buttons: InlineKeyboardButton[][] = result.customer_matches.map((m, i) => [{
      text:          `${i + 1}. ${m.name}`,
      callback_data: `pick_schedule_customer:${i}`,
    }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_schedule" }])
    await send(lines.join("\n"), buttons)
    return
  }

  // Job disambiguation
  if (result.needs_schedule_job_selection && result.job_matches?.length) {
    pendingScheduleJobPicks.set(senderKey, { scheduleData, matches: result.job_matches })
    const lines = ["Multiple jobs found — which job do you want to schedule?"]
    const buttons: InlineKeyboardButton[][] = result.job_matches.map((j, i) => [{
      text:          `${i + 1}. ${j.title}`,
      callback_data: `pick_schedule_job:${i}`,
    }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_schedule" }])
    await send(lines.join("\n"), buttons)
    return
  }

  if (!result.approval_id || !result.schedule_preview) {
    await send(result.response_text ?? "Failed to create schedule approval. Please try again.")
    return
  }

  const previewText = formatSchedulePreview(result.approval_id, result.schedule_preview)
  const buttons: InlineKeyboardButton[][] = [[
    { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
    { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
    { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
  ]]
  await send(previewText, buttons)
}

// ─── Contract preview formatter ──────────────────────────────────────────────

function formatContractPreview(approvalId: string, preview: ContractPreview): string {
  const lines = ["📜 Send Contract — Pending Approval", ""]
  lines.push(`👤 Customer: ${preview.customer_name}`)
  lines.push(`📧 Send to: ${preview.customer_email}`)
  if (preview.job_title) lines.push(`🔨 Job: ${preview.job_title}`)
  lines.push("")
  if (preview.templates.length === 1) {
    lines.push(`📄 Contract: ${preview.templates[0].name}`)
  } else {
    lines.push(`📄 Contracts (${preview.templates.length}):`)
    preview.templates.forEach((t, i) => lines.push(`  ${i + 1}. ${t.name}`))
  }
  lines.push("")
  lines.push(`🔗 Signing: Single bundle link (customer signs all in one session)`)
  if (preview.crm_url) lines.push(`🔗 CRM: ${preview.crm_url}`)
  lines.push("", `⚠️ This will send a signing email to ${preview.customer_email}.`)
  lines.push("", `ID: ${approvalId}`)
  return lines.join("\n")
}

// ─── Shared contract handler ──────────────────────────────────────────────────

async function handleSendContract(
  rawText:   string,
  senderKey: string,
  send:      SendFn,
): Promise<void> {
  const parsed = parseContractMessage(rawText)

  if (!parsed.customer_name) {
    await send(
      "To send a contract, I need a customer name.\n\n" +
      "Example: \"Lia, send home improvement contract to John Smith for paver job\"",
    )
    return
  }

  const contractData: ContractData = {
    customer_name:      parsed.customer_name  ?? undefined,
    job_title_hint:     parsed.job_title_hint ?? undefined,
    template_name_hint: parsed.template_name_hint ?? undefined,
    bundle_all:         parsed.bundle_all,
  }

  const result = await sendMessage({
    message:       rawText,
    sender:        senderKey,
    intent:        "send_contract",
    contract_data: contractData,
  })

  await handleContractResult(result, contractData, senderKey, send)
}

async function handleContractResult(
  result:       CrmMessageResponse,
  contractData: ContractData,
  senderKey:    string,
  send:         SendFn,
): Promise<void> {
  if (result.not_found) {
    await send(result.response_text ?? "No customer or job found. Check the name and try again.")
    return
  }
  if (result.no_jobs) {
    await send(result.response_text ?? "No active jobs found for this customer.")
    return
  }
  if (result.no_email) {
    await send(result.response_text ?? "This customer has no email address on file. Add an email to the customer record first.")
    return
  }
  if (result.no_templates) {
    await send(result.response_text ?? "No contract templates are set up. Add templates in the CRM first.")
    return
  }
  if (result.missing_fields?.length) {
    await send(`To send the contract, I still need: ${result.missing_fields.join(", ")}.`)
    return
  }

  // Customer disambiguation
  if (result.needs_contract_customer_disambiguation && result.customer_matches?.length) {
    pendingContractCustomerPicks.set(senderKey, { contractData, matches: result.customer_matches })
    const buttons: InlineKeyboardButton[][] = result.customer_matches.map((m, i) => [{
      text: `${i + 1}. ${m.name}`, callback_data: `pick_contract_customer:${i}`,
    }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_contract" }])
    await send("Multiple customers found — choose one:", buttons)
    return
  }

  // Job disambiguation
  if (result.needs_contract_job_selection && result.job_matches?.length) {
    pendingContractJobPicks.set(senderKey, { contractData, matches: result.job_matches })
    const buttons: InlineKeyboardButton[][] = result.job_matches.map((j, i) => [{
      text: `${i + 1}. ${j.title}`, callback_data: `pick_contract_job:${i}`,
    }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_contract" }])
    await send("Multiple jobs found — which job is this contract for?", buttons)
    return
  }

  // Template selection
  if (result.needs_template_selection && result.available_templates?.length) {
    pendingContractTemplatePicks.set(senderKey, { contractData, templates: result.available_templates })
    const buttons: InlineKeyboardButton[][] = result.available_templates.map((t, i) => [{
      text: `${i + 1}. ${t.name}`, callback_data: `pick_contract_template:${i}`,
    }])
    buttons.push([{ text: "📋 Send All", callback_data: "pick_all_contracts" }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_contract" }])
    await send("Which contract(s) do you want to send?", buttons)
    return
  }

  if (!result.approval_id || !result.contract_preview) {
    await send(result.response_text ?? "Failed to create contract approval. Please try again.")
    return
  }

  const previewText = formatContractPreview(result.approval_id, result.contract_preview)
  await send(previewText, [[
    { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
    { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
    { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
  ]])
}

// ─── Shared invoice handler ───────────────────────────────────────────────────

async function handleInvoice(
  rawText:   string,
  senderKey: string,
  send:      SendFn,
): Promise<void> {
  const parsed = parseInvoiceMessage(rawText)

  if (!parsed.customer_name && !parsed.amount) {
    await send(
      "To create an invoice, I need a customer name and amount.\n\n" +
      "Example: invoice John Smith $2500 for deposit",
    )
    return
  }
  if (!parsed.amount) {
    await send(`Got customer "${parsed.customer_name}" but I need an amount.\n\nExample: invoice ${parsed.customer_name} $2500 deposit`)
    return
  }

  const result = await sendMessage({
    message:      rawText,
    sender:       senderKey,
    intent:       "create_invoice",
    invoice_data: {
      customer_name:  parsed.customer_name,
      amount:         parsed.amount,
      type:           parsed.type,
      notes:          parsed.notes,
      due_date:       parsed.due_date,
      job_title_hint: parsed.notes,
    },
  })

  if (result.missing_fields?.length) {
    await send(`To create the invoice, I still need: ${result.missing_fields.join(", ")}.`)
    return
  }

  if (result.not_found) {
    await send(result.response_text ?? `No customer found matching "${parsed.customer_name}". Check the name and try again.`)
    return
  }

  if (result.needs_disambiguation && result.customer_matches?.length) {
    pendingInvoicePicks.set(senderKey, {
      parsedText:  rawText,
      invoiceData: {
        customer_name: parsed.customer_name,
        amount:        parsed.amount,
        type:          parsed.type,
        notes:         parsed.notes,
        due_date:      parsed.due_date,
      },
      matches: result.customer_matches,
    })

    const lines = ["Multiple customers found — choose one:"]
    const buttons: InlineKeyboardButton[][] = result.customer_matches.map((m, i) => [{
      text:          `${i + 1}. ${m.name}${m.email ? ` (${m.email})` : ""}`,
      callback_data: `pick_customer:${i}`,
    }])
    buttons.push([{ text: "❌ Cancel", callback_data: "cancel_invoice" }])
    await send(lines.join("\n"), buttons)
    return
  }

  if (result.no_jobs) {
    await send(result.response_text ?? "No active jobs found for this customer. Please create a job first.")
    return
  }

  if (result.needs_job_selection && result.job_matches?.length) {
    pendingJobPicks.set(senderKey, {
      invoiceData: {
        customer_id:   result.resolved_customer_id,
        customer_name: result.resolved_customer_name,
        amount:        parsed.amount,
        type:          parsed.type,
        notes:         parsed.notes,
        due_date:      parsed.due_date,
      },
      matches: result.job_matches,
    })
    const jobLines = ["Multiple jobs found — which job is this invoice for?"]
    const jobButtons: InlineKeyboardButton[][] = result.job_matches.map((j, i) => [{
      text:          `${i + 1}. ${j.title}`,
      callback_data: `pick_job:${i}`,
    }])
    jobButtons.push([{ text: "❌ Cancel", callback_data: "cancel_invoice" }])
    await send(jobLines.join("\n"), jobButtons)
    return
  }

  if (!result.approval_id || !result.invoice_preview) {
    await send(result.response_text ?? "Failed to create invoice approval. Please try again.")
    return
  }

  const previewText = formatInvoicePreview(result.approval_id, result.invoice_preview)
  const buttons: InlineKeyboardButton[][] = [[
    { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
    { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
    { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
  ]]
  await send(previewText, buttons)
}

// ─── Shared lead handler ──────────────────────────────────────────────────────

type SendFn = (text: string, buttons?: InlineKeyboardButton[][]) => Promise<void>

async function handleLeadEstimate(
  rawText: string,
  senderKey: string,
  send: SendFn,
  oldApprovalId?: string,
): Promise<void> {
  const parsed = parseLeadEstimateMessage(rawText)

  if (!parsed.lead.name) {
    await send(
      "To create the lead, I still need: customer name.\n\n" +
      "Send the lead details like this:\n" +
      "name - Full Name\nphone 555-555-5555\nemail name@example.com\nneeds painting\ncharge 5000"
    )
    return
  }

  // Reject old approval if this is an edit correction
  if (oldApprovalId) {
    await updateApproval(oldApprovalId, "rejected").catch(() => {})
  }

  const result = await sendMessage({
    message: rawText,
    sender: senderKey,
    intent: "add_lead_estimate",
    lead: parsed.lead,
    estimate: parsed.estimate,
    wants_estimate: parsed.wants_estimate,
  })

  if (result.missing_fields?.length) {
    await send(`To create the lead, I still need: ${result.missing_fields.join(", ")}.`)
    return
  }

  if (!result.approval_id) {
    await send("Failed to create approval. Please try again.")
    return
  }

  const previewText = formatLeadPreview(
    result.approval_id,
    result.lead ?? parsed.lead,
    result.estimate ?? parsed.estimate,
    result.wants_estimate ?? parsed.wants_estimate,
  )

  const buttons: InlineKeyboardButton[][] = [[
    { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
    { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
    { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
  ]]

  await send(previewText, buttons)
}

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "lia-bridge", timestamp: new Date().toISOString() })
})

// ─── Incoming WhatsApp webhook ────────────────────────────────────────────────

app.post("/webhook/message", async (req: Request, res: Response) => {
  res.json({ ok: true })

  const payload = req.body as IncomingWebhook
  const from    = payload.from ?? ""
  const text    = (payload.type === "button_reply" ? payload.buttonId : payload.message) ?? ""

  if (!from || !text) return
  if (!isAllowed(from)) {
    console.log(`[lia] Blocked unauthorized sender: ${from}`)
    return
  }

  const chatKey = from
  const intent  = parseIntent(text)
  console.log(`[lia] ${from} → intent: ${intent.type}`)

  // WhatsApp send helper (no inline buttons, falls back to text instructions)
  const sendWA = async (msg: string, buttons?: InlineKeyboardButton[][]): Promise<void> => {
    let out = msg
    if (buttons?.length) {
      // Extract approval ID from the first button's callback_data
      const first = buttons[0]?.[0]?.callback_data ?? ""
      const idMatch = first.match(/[0-9a-f-]{36}/)
      if (idMatch) {
        const id = idMatch[0]
        out += `\n\nReply with:\nAPPROVE ${id} — to approve\nREJECT ${id} — to reject\nEDIT ${id} — to edit`
      }
    }
    await sendWhatsAppText(from, out)
  }

  try {
    // ── Pending edit: next message is a lead correction ──
    const pendingEdit = pendingEdits.get(chatKey)
    if (pendingEdit && (intent.type === "unknown" || intent.type === "add_lead_estimate")) {
      pendingEdits.delete(chatKey)
      await handleLeadEstimate(text, chatKey, sendWA, pendingEdit.oldApprovalId)
      return
    }

    if (intent.type === "health_check") {
      let crmOk = false
      try { const h = await checkHealth(); crmOk = h.crm_connection === "ok" } catch { /* skip */ }
      await sendWhatsAppText(from, [
        "Yes. I'm connected to Omdan Command Center.",
        `CRM connection: ${crmOk ? "OK" : "Error — check CRM"}`,
        "User verified: Owner/Admin",
        "WhatsApp connection: OK",
        "Approval system: Ready",
      ].join("\n"))
      return
    }

    if (intent.type === "daily_attention") {
      const result = await sendMessage({ message: text, sender: chatKey })
      const reply = result.summary
        ? formatDailySummary(result.summary)
        : (result.response_text ?? "No data available right now.")
      await sendWhatsAppText(from, reply)
      return
    }

    if (intent.type === "add_lead_estimate") {
      await handleLeadEstimate(text, chatKey, sendWA)
      return
    }

    if (intent.type === "edit_approval") {
      pendingEdits.set(chatKey, { oldApprovalId: intent.approvalId })
      await sendWhatsAppText(from, "✏️ Send me the corrected lead details and I'll update the preview.")
      return
    }

    if (intent.type === "approval_reply") {
      const { approvalId, action } = intent

      if (action === "reject") {
        await updateApproval(approvalId, "rejected")
        await sendWhatsAppText(from, "❌ Rejected.")
        return
      }

      // Approve → execute
      await updateApproval(approvalId, "approved")
      await sendWhatsAppText(from, "✅ Approved. Processing...")
      const result = await executeApproval(approvalId)

      if (result.error) {
        await sendWhatsAppText(from, `Error: ${result.error}`)
        return
      }

      if (result.action_type === "create_lead_estimate") {
        if (result.estimate_preview && result.send_approval_id) {
          const previewText = formatEstimatePreview(result.send_approval_id, result.estimate_preview)
          const buttons: InlineKeyboardButton[][] = [[
            { text: "✅ Send Email", callback_data: `approve:${result.send_approval_id}` },
            { text: "❌ Cancel",    callback_data: `reject:${result.send_approval_id}` },
          ]]
          await sendWA(previewText, buttons)
        } else {
          await sendWhatsAppText(from, result.message ?? "✅ Lead created.")
        }
      } else if (result.action_type === "send_estimate") {
        await sendWhatsAppText(from, `✅ Estimate sent to ${result.sent_to}`)
      }
      return
    }

    await sendWhatsAppText(
      from,
      "I didn't understand that.\n\nTry:\n• \"Lia, are you connected?\"\n• \"Lia, what needs my attention today?\"\n• \"Lia add this lead: name - John...\""
    )
  } catch (err) {
    console.error("[lia] Error handling message:", err)
    await sendWhatsAppText(from, "Something went wrong. Please try again or check the CRM.").catch(() => {})
  }
})

// ─── Incoming Telegram webhook ────────────────────────────────────────────────

app.post("/webhook/telegram", async (req: Request, res: Response) => {
  res.json({ ok: true })

  const update = req.body as {
    message?: {
      from?: { id: number; first_name?: string; username?: string }
      chat?: { id: number; type?: string; title?: string }
      text?: string
    }
    callback_query?: {
      id?: string
      from?: { id: number }
      message?: { chat?: { id: number } }
      data?: string
    }
  }

  const message  = update.message
  const callback = update.callback_query
  const fromId   = message?.from?.id ?? callback?.from?.id
  const chatId   = message?.chat?.id ?? callback?.message?.chat?.id
  const text     = message?.text ?? callback?.data ?? ""

  // DEBUG: log chat/user identity to help retrieve group chat ID
  if (message) {
    console.log(
      `[telegram-debug] from=${message.from?.id ?? "?"} username=${message.from?.username ?? "?"} ` +
      `chat=${message.chat?.id ?? "?"} type=${message.chat?.type ?? "?"} ` +
      `title="${message.chat?.title ?? ""}" text="${message.text ?? ""}"`
    )
  }

  if (!fromId || !chatId || !text) return

  if (!TELEGRAM_ALLOWED_IDS.has(fromId)) {
    console.log(`[lia/telegram] Blocked unauthorized user: ${fromId}`)
    return
  }

  const chatKey = String(chatId)
  const intent  = parseIntent(text)
  console.log(`[lia/telegram] ${fromId} → intent: ${intent.type}`)

  // Telegram send helper (uses inline buttons when provided)
  const sendTG = async (msg: string, buttons?: InlineKeyboardButton[][]): Promise<void> => {
    if (buttons?.length) {
      await sendTelegramWithButtons(chatId, msg, buttons)
    } else {
      await sendTelegramMessage(chatId, msg)
    }
  }

  try {
    // ── Pending edit: route correction to the right handler ──
    const pendingEdit = pendingEdits.get(chatKey)
    if (pendingEdit && (intent.type === "unknown" || intent.type === "add_lead_estimate")) {
      pendingEdits.delete(chatKey)
      await handleLeadEstimate(text, chatKey, sendTG, pendingEdit.oldApprovalId)
      return
    }
    if (pendingEdit && intent.type === "create_invoice") {
      const { oldApprovalId } = pendingEdit
      pendingEdits.delete(chatKey)
      await updateApproval(oldApprovalId, "rejected").catch(() => {})
      await handleInvoice(text, chatKey, sendTG)
      return
    }
    if (pendingEdit && intent.type === "schedule_job") {
      const { oldApprovalId } = pendingEdit
      pendingEdits.delete(chatKey)
      await updateApproval(oldApprovalId, "rejected").catch(() => {})
      await handleScheduleJob(text, chatKey, sendTG)
      return
    }
    if (pendingEdit && intent.type === "send_contract") {
      const { oldApprovalId } = pendingEdit
      pendingEdits.delete(chatKey)
      await updateApproval(oldApprovalId, "rejected").catch(() => {})
      await handleSendContract(text, chatKey, sendTG)
      return
    }

    // ── cancel_invoice ──────────────────────────────────────────────────────
    if (intent.type === "cancel_invoice") {
      pendingInvoicePicks.delete(chatKey)
      pendingJobPicks.delete(chatKey)
      await sendTelegramMessage(chatId, "Invoice request cancelled.")
      return
    }

    // ── cancel_schedule ─────────────────────────────────────────────────────
    if (intent.type === "cancel_schedule") {
      pendingScheduleCustomerPicks.delete(chatKey)
      pendingScheduleJobPicks.delete(chatKey)
      await sendTelegramMessage(chatId, "Schedule request cancelled.")
      return
    }

    // ── cancel_contract ──────────────────────────────────────────────────────
    if (intent.type === "cancel_contract") {
      pendingContractCustomerPicks.delete(chatKey)
      pendingContractJobPicks.delete(chatKey)
      pendingContractTemplatePicks.delete(chatKey)
      await sendTelegramMessage(chatId, "Contract request cancelled.")
      return
    }

    // ── Customer disambiguation reply ────────────────────────────────────────
    if (intent.type === "pick_customer") {
      const pending = pendingInvoicePicks.get(chatKey)
      if (!pending) {
        await sendTelegramMessage(chatId, "No pending customer selection. Re-send your invoice request.")
        return
      }
      const match = pending.matches[intent.index]
      if (!match) {
        await sendTelegramMessage(chatId, "Invalid selection. Please try again.")
        return
      }
      pendingInvoicePicks.delete(chatKey)

      const result2 = await sendMessage({
        message:      pending.parsedText,
        sender:       chatKey,
        intent:       "create_invoice",
        invoice_data: {
          ...pending.invoiceData,
          customer_id:    match.id,
          customer_name:  match.name,
          job_title_hint: pending.invoiceData.notes,
        },
      })

      if (result2.no_jobs) {
        await sendTelegramMessage(chatId, result2.response_text ?? "No active jobs found for this customer. Please create a job first.")
        return
      }

      if (result2.needs_job_selection && result2.job_matches?.length) {
        pendingJobPicks.set(chatKey, {
          invoiceData: {
            customer_id:   result2.resolved_customer_id,
            customer_name: result2.resolved_customer_name,
            amount:        pending.invoiceData.amount,
            type:          pending.invoiceData.type,
            notes:         pending.invoiceData.notes,
            due_date:      pending.invoiceData.due_date,
          },
          matches: result2.job_matches,
        })
        const jLines = ["Multiple jobs found — which job is this invoice for?"]
        const jButtons: InlineKeyboardButton[][] = result2.job_matches.map((j, i) => [{
          text:          `${i + 1}. ${j.title}`,
          callback_data: `pick_job:${i}`,
        }])
        jButtons.push([{ text: "❌ Cancel", callback_data: "cancel_invoice" }])
        await sendTelegramWithButtons(chatId, jLines.join("\n"), jButtons)
        return
      }

      if (!result2.approval_id || !result2.invoice_preview) {
        await sendTelegramMessage(chatId, result2.response_text ?? "Failed to create invoice approval.")
        return
      }
      const previewText2 = formatInvoicePreview(result2.approval_id, result2.invoice_preview)
      await sendTelegramWithButtons(chatId, previewText2, [[
        { text: "✅ Approve", callback_data: `approve:${result2.approval_id}` },
        { text: "❌ Reject",  callback_data: `reject:${result2.approval_id}` },
        { text: "✏️ Edit",   callback_data: `edit:${result2.approval_id}` },
      ]])
      return
    }

    // ── Job disambiguation reply ─────────────────────────────────────────────
    if (intent.type === "pick_job") {
      const pending = pendingJobPicks.get(chatKey)
      if (!pending) {
        await sendTelegramMessage(chatId, "No pending job selection. Re-send your invoice request.")
        return
      }
      const match = pending.matches[intent.index]
      if (!match) {
        await sendTelegramMessage(chatId, "Invalid selection. Please try again.")
        return
      }
      pendingJobPicks.delete(chatKey)

      const result3 = await sendMessage({
        message:      "",
        sender:       chatKey,
        intent:       "create_invoice",
        invoice_data: { ...pending.invoiceData, job_id: match.id },
      })

      if (result3.no_jobs) {
        await sendTelegramMessage(chatId, result3.response_text ?? "Job not found. Please try again.")
        return
      }
      if (!result3.approval_id || !result3.invoice_preview) {
        await sendTelegramMessage(chatId, result3.response_text ?? "Failed to create invoice approval.")
        return
      }
      const previewText3 = formatInvoicePreview(result3.approval_id, result3.invoice_preview)
      await sendTelegramWithButtons(chatId, previewText3, [[
        { text: "✅ Approve", callback_data: `approve:${result3.approval_id}` },
        { text: "❌ Reject",  callback_data: `reject:${result3.approval_id}` },
        { text: "✏️ Edit",   callback_data: `edit:${result3.approval_id}` },
      ]])
      return
    }

    // ── Schedule customer disambiguation reply ───────────────────────────────
    if (intent.type === "pick_schedule_customer") {
      const pending = pendingScheduleCustomerPicks.get(chatKey)
      if (!pending) {
        await sendTelegramMessage(chatId, "No pending customer selection. Re-send your schedule request.")
        return
      }
      const match = pending.matches[intent.index]
      if (!match) {
        await sendTelegramMessage(chatId, "Invalid selection. Please try again.")
        return
      }
      pendingScheduleCustomerPicks.delete(chatKey)

      const result = await sendMessage({
        message:       "",
        sender:        chatKey,
        intent:        "schedule_job",
        schedule_data: { ...pending.scheduleData, customer_id: match.id, customer_name: match.name },
      })

      if (result.no_jobs) {
        await sendTelegramMessage(chatId, result.response_text ?? `No active jobs found for ${match.name}.`)
        return
      }
      if (result.needs_schedule_job_selection && result.job_matches?.length) {
        pendingScheduleJobPicks.set(chatKey, {
          scheduleData: { ...pending.scheduleData, customer_id: match.id, customer_name: match.name },
          matches: result.job_matches,
        })
        const jButtons: InlineKeyboardButton[][] = result.job_matches.map((j, i) => [{
          text: `${i + 1}. ${j.title}`, callback_data: `pick_schedule_job:${i}`,
        }])
        jButtons.push([{ text: "❌ Cancel", callback_data: "cancel_schedule" }])
        await sendTelegramWithButtons(chatId, "Multiple jobs found — which one do you want to schedule?", jButtons)
        return
      }
      if (!result.approval_id || !result.schedule_preview) {
        await sendTelegramMessage(chatId, result.response_text ?? "Failed to create schedule approval.")
        return
      }
      await sendTelegramWithButtons(chatId, formatSchedulePreview(result.approval_id, result.schedule_preview), [[
        { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
        { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
        { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
      ]])
      return
    }

    // ── Schedule job disambiguation reply ────────────────────────────────────
    if (intent.type === "pick_schedule_job") {
      const pending = pendingScheduleJobPicks.get(chatKey)
      if (!pending) {
        await sendTelegramMessage(chatId, "No pending job selection. Re-send your schedule request.")
        return
      }
      const match = pending.matches[intent.index]
      if (!match) {
        await sendTelegramMessage(chatId, "Invalid selection. Please try again.")
        return
      }
      pendingScheduleJobPicks.delete(chatKey)

      const result = await sendMessage({
        message:       "",
        sender:        chatKey,
        intent:        "schedule_job",
        schedule_data: { ...pending.scheduleData, job_id: match.id },
      })

      if (!result.approval_id || !result.schedule_preview) {
        await sendTelegramMessage(chatId, result.response_text ?? "Failed to create schedule approval.")
        return
      }
      await sendTelegramWithButtons(chatId, formatSchedulePreview(result.approval_id, result.schedule_preview), [[
        { text: "✅ Approve", callback_data: `approve:${result.approval_id}` },
        { text: "❌ Reject",  callback_data: `reject:${result.approval_id}` },
        { text: "✏️ Edit",   callback_data: `edit:${result.approval_id}` },
      ]])
      return
    }

    // ── Contract customer disambiguation ─────────────────────────────────────
    if (intent.type === "pick_contract_customer") {
      const pending = pendingContractCustomerPicks.get(chatKey)
      if (!pending) { await sendTelegramMessage(chatId, "No pending customer selection. Re-send your contract request."); return }
      const match = pending.matches[intent.index]
      if (!match) { await sendTelegramMessage(chatId, "Invalid selection. Please try again."); return }
      pendingContractCustomerPicks.delete(chatKey)

      const result = await sendMessage({
        message: "", sender: chatKey, intent: "send_contract",
        contract_data: { ...pending.contractData, customer_id: match.id, customer_name: match.name },
      })
      await handleContractResult(result, { ...pending.contractData, customer_id: match.id, customer_name: match.name }, chatKey, sendTG)
      return
    }

    // ── Contract job disambiguation ───────────────────────────────────────────
    if (intent.type === "pick_contract_job") {
      const pending = pendingContractJobPicks.get(chatKey)
      if (!pending) { await sendTelegramMessage(chatId, "No pending job selection. Re-send your contract request."); return }
      const match = pending.matches[intent.index]
      if (!match) { await sendTelegramMessage(chatId, "Invalid selection. Please try again."); return }
      pendingContractJobPicks.delete(chatKey)

      const result = await sendMessage({
        message: "", sender: chatKey, intent: "send_contract",
        contract_data: { ...pending.contractData, job_id: match.id },
      })
      await handleContractResult(result, { ...pending.contractData, job_id: match.id }, chatKey, sendTG)
      return
    }

    // ── Contract template selection ───────────────────────────────────────────
    if (intent.type === "pick_contract_template" || intent.type === "pick_all_contracts") {
      const pending = pendingContractTemplatePicks.get(chatKey)
      if (!pending) { await sendTelegramMessage(chatId, "No pending template selection. Re-send your contract request."); return }

      let selectedIds: string[]
      if (intent.type === "pick_all_contracts") {
        selectedIds = pending.templates.map((t) => t.id)
      } else {
        const match = pending.templates[intent.index]
        if (!match) { await sendTelegramMessage(chatId, "Invalid selection. Please try again."); return }
        selectedIds = [match.id]
      }
      pendingContractTemplatePicks.delete(chatKey)

      const result = await sendMessage({
        message: "", sender: chatKey, intent: "send_contract",
        contract_data: { ...pending.contractData, template_ids: selectedIds },
      })
      await handleContractResult(result, { ...pending.contractData, template_ids: selectedIds }, chatKey, sendTG)
      return
    }

    if (intent.type === "health_check") {
      let crmOk = false
      let approvalReady = false
      try {
        const h = await checkHealth()
        crmOk = h.crm_connection === "ok"
        approvalReady = h.approval_system === "ready"
      } catch { /* skip */ }
      await sendTelegramMessage(chatId, [
        "Yes. I'm connected to Omdan Command Center.",
        `CRM connection: ${crmOk ? "OK" : "Error — check CRM"}`,
        "User verified: Owner/Admin",
        `Approval system: ${approvalReady ? "Ready" : "Check required"}`,
      ].join("\n"))
      return
    }

    if (intent.type === "daily_attention") {
      const result = await sendMessage({ message: text, sender: chatKey })
      const reply = result.summary
        ? formatDailySummary(result.summary)
        : (result.response_text ?? "No data available right now.")
      await sendTelegramMessage(chatId, reply)
      return
    }

    if (intent.type === "add_lead_estimate") {
      await handleLeadEstimate(text, chatKey, sendTG)
      return
    }

    if (intent.type === "create_invoice") {
      await handleInvoice(text, chatKey, sendTG)
      return
    }

    if (intent.type === "schedule_job") {
      await handleScheduleJob(text, chatKey, sendTG)
      return
    }

    if (intent.type === "send_contract") {
      await handleSendContract(text, chatKey, sendTG)
      return
    }

    if (intent.type === "edit_approval") {
      pendingEdits.set(chatKey, { oldApprovalId: intent.approvalId })
      await sendTelegramMessage(chatId, "✏️ Send me the updated details and I'll create a new preview.")
      return
    }

    if (intent.type === "approval_reply") {
      const { approvalId, action } = intent

      if (action === "reject") {
        await updateApproval(approvalId, "rejected")
        await sendTelegramMessage(chatId, "❌ Rejected.")
        return
      }

      // Approve → execute
      await updateApproval(approvalId, "approved")
      await sendTelegramMessage(chatId, "✅ Approved. Processing...")
      const result = await executeApproval(approvalId)

      if (result.error) {
        await sendTelegramMessage(chatId, `⚠️ Error: ${result.error}`)
        return
      }

      if (result.action_type === "create_lead_estimate") {
        if (result.estimate_preview && result.send_approval_id) {
          const previewText = formatEstimatePreview(result.send_approval_id, result.estimate_preview)
          const buttons: InlineKeyboardButton[][] = [[
            { text: "✅ Send Email", callback_data: `approve:${result.send_approval_id}` },
            { text: "❌ Cancel",    callback_data: `reject:${result.send_approval_id}` },
          ]]
          await sendTG(previewText, buttons)
        } else {
          await sendTelegramMessage(chatId, result.message ?? "✅ Lead created.")
        }
      } else if (result.action_type === "send_estimate") {
        await sendTelegramMessage(chatId, `✅ Estimate sent to ${result.sent_to}`)
      } else if (result.action_type === "create_send_invoice") {
        if (result.warning) {
          await sendTelegramMessage(chatId, `⚠️ ${result.warning}`)
        } else {
          const invoiceRef = result.invoice_number ? ` (${result.invoice_number})` : ""
          await sendTelegramMessage(chatId, `✅ Invoice${invoiceRef} sent to ${result.sent_to}`)
        }
      } else if (result.action_type === "schedule_job") {
        if (result.error) {
          await sendTelegramMessage(chatId, `⚠️ ${result.error}`)
        } else {
          const dateStr = result.scheduled_date ? formatScheduledDate(result.scheduled_date) : "date unknown"
          const timeStr = formatScheduledTime(result.scheduled_time ?? null)
          await sendTelegramMessage(chatId, `✅ Scheduled: ${result.job_title ?? "Job"} — ${dateStr} at ${timeStr}`)
        }
      } else if (result.action_type === "send_contracts") {
        if (result.warning) {
          await sendTelegramMessage(chatId, `⚠️ ${result.warning}`)
        } else {
          const count = result.count ?? 1
          await sendTelegramMessage(chatId,
            `✅ ${count === 1 ? "Contract" : `${count} contracts`} sent to ${result.sent_to}`)
        }
      }
      return
    }

    await sendTelegramMessage(
      chatId,
      "I didn't understand that.\n\nTry:\n• \"Lia, are you connected?\"\n• \"Lia, what needs my attention today?\"\n• \"Lia add this lead: name - John...\"\n• \"Lia invoice John Smith $2500 deposit\"\n• \"Lia, schedule John Smith paver job for Monday at 9am\"\n• \"Lia, send contract to John Smith for paver job\""
    )
  } catch (err) {
    console.error("[lia/telegram] Error:", err)
    await sendTelegramMessage(chatId, "Something went wrong. Please try again.").catch(() => {})
  }
})

// ─── CRM notification push ───────────────────────────────────────────────────
// POST /notify — receives a structured event from the CRM and sends Telegram
// messages to all allowed owner IDs. Protected by x-assistant-secret.

interface NotifyBody {
  event_type: string
  customer_name?: string
  customer_email?: string
  document_name?: string
  amount?: number
  crm_url?: string
  extra?: string
}

const EVENT_LABELS: Record<string, string> = {
  estimate_approved:      "Estimate Approved",
  estimate_declined:      "Estimate Declined",
  change_order_approved:  "Change Order Approved",
  change_order_declined:  "Change Order Declined",
  contract_signed:        "Contract Signed",
  estimate_sent:          "Estimate Sent",
  invoice_sent:           "Invoice Sent",
  estimate_send_failed:   "Estimate Send Failed",
  invoice_send_failed:    "Invoice Send Failed",
  contract_send_failed:   "Contract Send Failed",
}

function formatNotification(body: NotifyBody): string {
  const label = EVENT_LABELS[body.event_type] ?? body.event_type
  const lines: string[] = [`Lia — ${label}`, ""]

  if (body.customer_name) lines.push(`Customer: ${body.customer_name}`)
  if (body.document_name) {
    const docLabel =
      body.event_type.startsWith("estimate") ? "Estimate" :
      body.event_type.startsWith("change_order") ? "Change Order" :
      body.event_type.startsWith("contract") ? "Contract" :
      body.event_type.startsWith("invoice") ? "Invoice" : "Document"
    lines.push(`${docLabel}: ${body.document_name}`)
  }
  if (body.amount != null) {
    lines.push(`Amount: $${Number(body.amount).toLocaleString("en-US")}`)
  }
  if (body.extra) lines.push(`Note: ${body.extra}`)
  if (body.crm_url) {
    lines.push("", body.crm_url)
  }

  return lines.join("\n")
}

app.post("/notify", async (req: Request, res: Response) => {
  // Verify shared secret
  const incoming = req.headers["x-assistant-secret"]
  const expected = process.env.CRM_ASSISTANT_SECRET
  if (!incoming || incoming !== expected) {
    res.status(401).json({ error: "Unauthorized" })
    return
  }

  res.json({ ok: true })   // acknowledge immediately

  const body = req.body as NotifyBody
  if (!body?.event_type) return

  const message = formatNotification(body)
  console.log(`[lia/notify] ${body.event_type} — ${body.customer_name ?? ""}`)

  // Send to all allowed Telegram IDs
  for (const chatId of TELEGRAM_ALLOWED_IDS) {
    sendTelegramMessage(chatId, message).catch((err) => {
      console.error(`[lia/notify] Telegram send failed for ${chatId}:`, err?.message)
    })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[lia-bridge] Listening on port ${PORT}`)
  console.log(`[lia-bridge] CRM: ${process.env.CRM_BASE_URL}`)
  console.log(`[lia-bridge] Allowed WhatsApp numbers: ${ALLOWED_NUMBERS.join(", ") || "(none)"}`)
  console.log(`[lia-bridge] Allowed Telegram IDs: ${[...TELEGRAM_ALLOWED_IDS].join(", ") || "(none — set TELEGRAM_ALLOWED_USER_IDS)"}`)
  startScheduler(TELEGRAM_ALLOWED_IDS)
})
