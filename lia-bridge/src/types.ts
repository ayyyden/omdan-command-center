// ─── Incoming webhook from OpenClaw ───────────────────────────────────────────
// Adapt field names to match your actual OpenClaw webhook payload.

export interface IncomingWebhook {
  from: string         // WhatsApp sender number, e.g. "15551234567" or "15551234567@s.whatsapp.net"
  message: string      // Message text body
  messageId: string    // OpenClaw message ID (for deduplication)
  timestamp: number    // Unix epoch seconds
  type: "text" | "button_reply" | "list_reply"
  buttonId?: string    // For interactive button replies (e.g. "approve_<uuid>")
  buttonTitle?: string
}

// ─── CRM API responses ────────────────────────────────────────────────────────

export interface CrmHealthResponse {
  status: string
  service: string
  crm_connection: string
  approval_system: string
  timestamp: string
}

export interface CrmMessageResponse {
  intent: string
  response_text?: string
  summary?: DailySummary
}

export interface DailySummary {
  date: string
  today_jobs: Array<{
    id: string
    title: string
    scheduled_time: string | null
    status: string
    customer: { name: string } | null
  }>
  overdue_jobs: Array<{
    id: string
    title: string
    scheduled_date: string
    status: string
    customer: { name: string } | null
  }>
  pending_estimates: Array<{
    id: string
    title: string | null
    total: number | null
    created_at: string
    customer: { name: string } | null
  }>
  unsigned_contracts: Array<{
    id: string
    sent_at: string | null
    recipient_email: string | null
    contract_template: { name: string } | null
  }>
  unpaid_invoices: Array<{
    id: string
    amount: number | null
    status: string
    due_date: string | null
    job: { title: string; customer: { name: string } | null } | null
  }>
  pending_approvals: Array<{
    id: string
    action_type: string
    action_summary: string
    created_at: string
  }>
}

export interface AssistantApproval {
  id: string
  channel: string
  action_type: string
  action_summary: string
  proposed_payload: unknown
  status: string
  expires_at: string
  created_at: string
}
