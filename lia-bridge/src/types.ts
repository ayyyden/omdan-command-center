// ─── Incoming webhook from OpenClaw ───────────────────────────────────────────

export interface IncomingWebhook {
  from: string         // WhatsApp sender number, e.g. "15551234567" or "15551234567@s.whatsapp.net"
  message: string      // Message text body
  messageId: string    // OpenClaw message ID (for deduplication)
  timestamp: number    // Unix epoch seconds
  type: "text" | "button_reply" | "list_reply"
  buttonId?: string    // For interactive button replies (e.g. "approve_<uuid>")
  buttonTitle?: string
}

// ─── CRM shared types ─────────────────────────────────────────────────────────

export interface LeadData {
  name?: string
  phone?: string
  email?: string
  service_type?: string
}

export interface PaymentStep {
  name: string
  amount: number
}

export interface EstimateData {
  services?: string
  total?: number
  payment_steps?: PaymentStep[]
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
  // add_lead_estimate response fields
  approval_id?: string
  lead?: LeadData
  estimate?: EstimateData | null
  wants_estimate?: boolean
  missing_fields?: string[]
}

export interface EstimatePreview {
  title: string
  customer_name: string
  email: string | null
  services: string | null
  total: number
  payment_steps: PaymentStep[]
  estimate_url: string
}

export interface ExecuteResponse {
  action_type: string
  // create_lead_estimate fields
  customer_id?: string
  estimate_id?: string | null
  send_approval_id?: string | null
  message?: string
  estimate_preview?: EstimatePreview
  // send_estimate fields
  success?: boolean
  sent_to?: string
  error?: string
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
