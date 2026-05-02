// Fire-and-forget Telegram notification helper.
// Posts to the Lia bridge /notify endpoint using the assistant shared secret.
// Never throws — log errors internally and move on.

export interface LiaNotificationEvent {
  event_type:
    | "estimate_approved" | "estimate_declined"
    | "change_order_approved" | "change_order_declined"
    | "contract_signed"
    | "estimate_sent" | "invoice_sent"
    | "estimate_send_failed" | "invoice_send_failed" | "contract_send_failed"
  customer_name?: string
  customer_email?: string
  document_name?: string   // estimate title, contract name, invoice number, etc.
  amount?: number
  crm_url?: string
  extra?: string           // decline reason, error message, etc.
}

export function notifyLia(event: LiaNotificationEvent): void {
  const bridgeUrl = process.env.LIA_BRIDGE_URL
  const secret    = process.env.ASSISTANT_SECRET
  if (!bridgeUrl || !secret) return   // not configured — skip silently

  fetch(`${bridgeUrl}/notify`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-assistant-secret": secret },
    body:    JSON.stringify(event),
    signal:  AbortSignal.timeout(8000),
  }).catch((err) => {
    console.error("[lia-notify] POST /notify failed:", err?.message ?? err)
  })
}
