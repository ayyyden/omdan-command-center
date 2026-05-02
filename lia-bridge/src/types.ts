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
  scope_override?: string  // manually provided scope text from "Scope:" section
}

export interface InvoiceData {
  customer_name?: string
  customer_id?: string      // set after customer disambiguation
  amount?: number
  type?: string             // deposit | progress | final | custom string
  notes?: string
  due_date?: string         // YYYY-MM-DD
  job_id?: string           // set after job disambiguation
  job_title_hint?: string   // from parsed notes, used to filter jobs
}

export interface ScheduleData {
  customer_name?: string
  customer_id?: string      // set after customer disambiguation
  job_id?: string           // set after job disambiguation
  job_title_hint?: string
  scheduled_date: string    // YYYY-MM-DD (required)
  scheduled_time?: string | null  // HH:MM
}

export interface CustomerMatch {
  id: string
  name: string
  email: string | null
}

export interface JobMatch {
  id: string
  title: string
}

export interface InvoicePreview {
  customer_name: string
  customer_email: string | null
  customer_id: string
  job_id: string | null
  job_title: string | null
  amount: number
  type: string
  type_label: string
  due_date: string | null
  notes: string | null
  payment_methods: string[]
}

export interface SchedulePreview {
  job_id: string
  job_title: string
  job_status: string
  customer_name: string
  customer_address: string | null
  current_scheduled_date: string | null
  current_scheduled_time: string | null
  new_scheduled_date: string
  new_scheduled_time: string | null
  pm_name: string | null
  crm_url: string
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
  // create_invoice response fields
  invoice_preview?: InvoicePreview
  needs_disambiguation?: boolean
  customer_matches?: CustomerMatch[]
  not_found?: boolean
  no_jobs?: boolean
  needs_job_selection?: boolean
  job_matches?: JobMatch[]
  resolved_customer_id?: string
  resolved_customer_name?: string
  resolved_customer_email?: string | null
  // schedule_job response fields
  schedule_preview?: SchedulePreview
  needs_customer_disambiguation?: boolean
  needs_schedule_job_selection?: boolean
  resolved_scheduled_date?: string
  resolved_scheduled_time?: string | null
  resolved_job_title_hint?: string | null
}

export interface EstimatePreview {
  title: string
  customer_name: string
  email: string | null
  services: string | null
  scope: string | null
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
  sent_to?: string | null
  error?: string
  // create_send_invoice fields
  invoice_id?: string
  invoice_number?: string | null
  warning?: string
  // schedule_job fields
  job_id?: string
  job_title?: string
  scheduled_date?: string
  scheduled_time?: string | null
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
