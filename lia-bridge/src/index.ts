import "dotenv/config"
import express, { type Request, type Response } from "express"
import { parseIntent }              from "./intent-parser"
import { parseLeadEstimateMessage } from "./lead-parser"
import { formatDailySummary }       from "./format-response"
import { sendWhatsAppText }         from "./openclaw-client"
import { sendTelegramMessage, sendTelegramWithButtons, type InlineKeyboardButton } from "./telegram-client"
import { checkHealth, sendMessage, updateApproval, executeApproval } from "./crm-client"
import type { IncomingWebhook, EstimatePreview, LeadData, EstimateData } from "./types"

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
      from?: { id: number; first_name?: string }
      chat?: { id: number }
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
    // ── Pending edit: next message is a lead correction ──
    const pendingEdit = pendingEdits.get(chatKey)
    if (pendingEdit && (intent.type === "unknown" || intent.type === "add_lead_estimate")) {
      pendingEdits.delete(chatKey)
      await handleLeadEstimate(text, chatKey, sendTG, pendingEdit.oldApprovalId)
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

    if (intent.type === "edit_approval") {
      pendingEdits.set(chatKey, { oldApprovalId: intent.approvalId })
      await sendTelegramMessage(chatId, "✏️ Send me the corrected lead details and I'll create a new preview.")
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
      }
      return
    }

    await sendTelegramMessage(
      chatId,
      "I didn't understand that.\n\nTry:\n• \"Lia, are you connected?\"\n• \"Lia, what needs my attention today?\"\n• \"Lia add this lead: name - John...\""
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
})
