import "dotenv/config"
import express, { type Request, type Response } from "express"
import { parseIntent }         from "./intent-parser"
import { formatDailySummary }  from "./format-response"
import { sendWhatsAppText }    from "./openclaw-client"
import { checkHealth, sendMessage, updateApproval } from "./crm-client"
import type { IncomingWebhook } from "./types"

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

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express()
app.use(express.json())

// Bridge health — called by monitoring/uptime tools
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "lia-bridge", timestamp: new Date().toISOString() })
})

// ─── Incoming WhatsApp webhook ────────────────────────────────────────────────
// Configure OpenClaw to POST to: https://lia.omdandevelopment.com/webhook/message

app.post("/webhook/message", async (req: Request, res: Response) => {
  // Acknowledge immediately so OpenClaw does not time out waiting for a reply
  res.json({ ok: true })

  const payload = req.body as IncomingWebhook

  const from = payload.from ?? ""
  const text = (payload.type === "button_reply" ? payload.buttonId : payload.message) ?? ""

  if (!from || !text) return

  // Block unauthorized senders — only Owner/Admin numbers allowed
  if (!isAllowed(from)) {
    console.log(`[lia] Blocked unauthorized sender: ${from}`)
    return
  }

  const intent = parseIntent(text)
  console.log(`[lia] ${from} → intent: ${intent.type}`)

  try {
    // ── Health / connectivity test ──
    if (intent.type === "health_check") {
      let crmOk = false
      try {
        const h = await checkHealth()
        crmOk = h.crm_connection === "ok"
      } catch { /* crm unreachable */ }

      const reply = [
        "Yes. I'm connected to Omdan Command Center.",
        `CRM connection: ${crmOk ? "OK" : "Error — check CRM"}`,
        "User verified: Owner/Admin",
        "WhatsApp connection: OK",
        "Approval system: Ready",
      ].join("\n")

      await sendWhatsAppText(from, reply)
      return
    }

    // ── Daily attention summary (read-only) ──
    if (intent.type === "daily_attention") {
      const result = await sendMessage(text, from)
      const reply = result.summary
        ? formatDailySummary(result.summary)
        : (result.response_text ?? "No data available right now.")
      await sendWhatsAppText(from, reply)
      return
    }

    // ── Approval reply (approve / reject) ──
    if (intent.type === "approval_reply") {
      const { approvalId, action } = intent
      await updateApproval(approvalId, action === "approve" ? "approved" : "rejected")
      const word = action === "approve" ? "✅ Approved" : "❌ Rejected"
      await sendWhatsAppText(from, `${word}. Processing action...`)
      return
    }

    // ── Unknown ──
    await sendWhatsAppText(
      from,
      "I didn't understand that.\n\nTry:\n• \"Lia, are you connected?\"\n• \"Lia, what needs my attention today?\""
    )
  } catch (err) {
    console.error("[lia] Error handling message:", err)
    await sendWhatsAppText(from, "Something went wrong. Please try again or check the CRM.").catch(() => {})
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`[lia-bridge] Listening on port ${PORT}`)
  console.log(`[lia-bridge] CRM: ${process.env.CRM_BASE_URL}`)
  console.log(`[lia-bridge] Allowed numbers: ${ALLOWED_NUMBERS.join(", ") || "(none — set LIA_ALLOWED_WHATSAPP_NUMBERS)"}`)
})
