export type InvoiceStatus = "draft" | "sent" | "partial" | "paid"
export type InvoiceType = "deposit" | "progress" | "final"

export interface Invoice {
  id: string
  created_at: string
  user_id: string
  job_id: string
  customer_id: string
  type: InvoiceType
  status: InvoiceStatus
  amount: number
  due_date: string | null
  notes: string | null
}

export interface InvoiceWithBalance extends Invoice {
  amount_paid: number
  amount_remaining: number
}

export type LeadStatus =
  | "New Lead"
  | "Contacted"
  | "Estimate Sent"
  | "Follow-Up Needed"
  | "Approved"
  | "Scheduled"
  | "In Progress"
  | "Completed"
  | "Paid"
  | "Closed Lost"

export type JobStatus =
  | "scheduled"
  | "in_progress"
  | "completed"
  | "on_hold"
  | "cancelled"

export type EstimateStatus = "draft" | "sent" | "approved" | "rejected"

export type ExpenseCategory =
  | "labor"
  | "materials"
  | "subcontractors"
  | "permits"
  | "dump_fees"
  | "travel"
  | "equipment"
  | "gas"
  | "vehicle"
  | "tools"
  | "office_rent"
  | "software"
  | "insurance"
  | "marketing"
  | "meals"
  | "misc"

export type ExpenseType = "job" | "business"

export type PaymentMethod =
  | "cash"
  | "check"
  | "zelle"
  | "venmo"
  | "credit_card"
  | "bank_transfer"
  | "other"

export type LeadSource =
  | "referral"
  | "google"
  | "facebook"
  | "instagram"
  | "door_knock"
  | "repeat_customer"
  | "yard_sign"
  | "nextdoor"
  | "yelp"
  | "other"

export type ReminderType =
  | "estimate_follow_up"
  | "payment_reminder"
  | "material_reminder"
  | "review_request"
  | "custom"
  | "job_reminder"

export interface Customer {
  id: string
  created_at: string
  updated_at: string
  name: string
  phone: string | null
  email: string | null
  address: string | null
  service_type: string | null
  lead_source: LeadSource | null
  status: LeadStatus
  notes: string | null
  user_id: string
}

export interface EstimateLineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  category: "labor" | "materials" | "subcontractor" | "other"
  taxable?: boolean
}

export interface Estimate {
  id: string
  created_at: string
  updated_at: string
  customer_id: string
  title: string
  scope_of_work: string | null
  line_items: EstimateLineItem[]
  markup_percent: number
  tax_percent: number
  subtotal: number
  markup_amount: number
  tax_amount: number
  total: number
  status: EstimateStatus
  notes: string | null
  sent_at: string | null
  approved_at: string | null
  user_id: string
  customer?: Customer
}

export interface ProjectManager {
  id: string
  created_at: string
  updated_at: string
  user_id: string
  name: string
  phone: string | null
  email: string | null
  is_active: boolean
  color: string
}

export interface Job {
  id: string
  created_at: string
  updated_at: string
  customer_id: string
  estimate_id: string | null
  title: string
  description: string | null
  status: JobStatus
  scheduled_date: string | null
  scheduled_time: string | null
  completion_date: string | null
  notes: string | null
  user_id: string
  project_manager_id: string | null
  estimated_duration_minutes: number
  customer?: Customer
  estimate?: Estimate
  project_manager?: ProjectManager
}

export interface Expense {
  id: string
  created_at: string
  updated_at: string
  job_id: string | null
  expense_type: ExpenseType
  category: ExpenseCategory
  description: string
  amount: number
  date: string
  receipt_url: string | null
  notes: string | null
  user_id: string
  job?: Job
}

export interface Payment {
  id: string
  created_at: string
  updated_at: string
  job_id: string
  customer_id: string
  amount: number
  method: PaymentMethod
  date: string
  notes: string | null
  user_id: string
  job?: Job
  customer?: Customer
}

export interface Reminder {
  id: string
  created_at: string
  updated_at: string
  customer_id: string | null
  job_id: string | null
  estimate_id: string | null
  type: ReminderType
  title: string
  due_date: string
  due_time?: string | null
  completed_at: string | null
  notes: string | null
  user_id: string
  customer?: Customer
  job?: Job
}

export interface ActivityLog {
  id: string
  created_at: string
  entity_type: "customer" | "estimate" | "job" | "expense" | "payment" | "reminder"
  entity_id: string
  action: string
  description: string
  user_id: string
}

export type MessageTemplateType =
  | "estimate_follow_up"
  | "job_scheduled"
  | "job_reminder"
  | "payment_reminder"
  | "review_request"
  | "custom"

export interface MessageTemplate {
  id: string
  user_id: string
  name: string
  type: MessageTemplateType
  subject: string | null
  body: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface CommunicationLog {
  id: string
  user_id: string
  customer_id: string | null
  job_id: string | null
  estimate_id: string | null
  template_id: string | null
  type: string
  subject: string | null
  body: string
  channel: string
  created_at: string
}

export interface JobProfitSummary {
  job_id: string
  job_title: string
  customer_name: string
  estimate_total: number
  total_payments: number
  total_expenses: number
  gross_profit: number
  profit_margin: number
  amount_unpaid: number
}
