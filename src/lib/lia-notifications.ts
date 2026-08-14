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

// Pushes a proactive action to Telegram — with real Approve/Reject buttons
// when tied to a pending assistant_approvals row (e.g. a bank-sync auto-draft),
// or a plain message otherwise (e.g. "which job is this deposit for?").
// Fire-and-forget, same as notifyLia — never blocks or throws.
export function notifyLiaAction(params: {
  text:           string
  approvalId?:    string
  actionType?:    string
  actionSummary?: string
  payload?:       Record<string, unknown>
}): void {
  const bridgeUrl = process.env.LIA_BRIDGE_URL
  const secret    = process.env.ASSISTANT_SECRET
  if (!bridgeUrl || !secret) return

  fetch(`${bridgeUrl}/notify-action`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", "x-assistant-secret": secret },
    body: JSON.stringify({
      text:           params.text,
      approval_id:    params.approvalId,
      action_type:    params.actionType,
      action_summary: params.actionSummary,
      payload:        params.payload,
    }),
    signal: AbortSignal.timeout(8000),
  }).catch((err) => {
    console.error("[lia-notify] POST /notify-action failed:", err?.message ?? err)
  })
}
