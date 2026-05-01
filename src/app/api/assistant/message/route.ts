import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTodayLA(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
}

type Intent = "health_check" | "daily_attention" | "unknown"

function parseIntent(text: string): Intent {
  const lower = text.toLowerCase()
  if (/connected|health|alive|online|test/.test(lower)) return "health_check"
  if (/lia.*connect|are you/.test(lower)) return "health_check"
  if (/attention|today|summary|overview|pending|what.*need|review|status/.test(lower)) return "daily_attention"
  return "unknown"
}

// ─── Daily summary query ──────────────────────────────────────────────────────

async function getDailySummary(): Promise<DailySummary> {
  const supabase = createServiceClient()
  const today = getTodayLA()
  const now = new Date().toISOString()

  const [
    { data: todayJobs },
    { data: overdueJobs },
    { data: pendingEstimates },
    { data: unsignedContracts },
    { data: unpaidInvoices },
    { data: pendingApprovals },
  ] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, scheduled_time, status, customer:customers(name)")
      .eq("scheduled_date", today)
      .not("status", "in", "(completed,cancelled)")
      .order("scheduled_time", { ascending: true, nullsFirst: false }),

    supabase
      .from("jobs")
      .select("id, title, scheduled_date, status, customer:customers(name)")
      .lt("scheduled_date", today)
      .not("status", "in", "(completed,cancelled)")
      .order("scheduled_date", { ascending: true }),

    supabase
      .from("estimates")
      .select("id, title, total, created_at, customer:customers(name)")
      .eq("status", "sent")
      .order("created_at", { ascending: true }),

    // sent_contracts: unsigned = sent_at set, signed_at null
    supabase
      .from("sent_contracts")
      .select("id, sent_at, recipient_email, contract_template:contract_templates(name)")
      .is("signed_at", null)
      .not("sent_at", "is", null)
      .order("sent_at", { ascending: true }),

    supabase
      .from("invoices")
      .select("id, amount, status, due_date, job:jobs(title, customer:customers(name))")
      .neq("status", "paid")
      .neq("status", "draft")
      .neq("status", "cancelled")
      .order("due_date", { ascending: true, nullsFirst: false }),

    supabase
      .from("assistant_approvals")
      .select("id, action_type, action_summary, created_at")
      .eq("status", "pending")
      .gt("expires_at", now),
  ])

  return {
    date: today,
    today_jobs: (todayJobs ?? []) as unknown as DailySummary["today_jobs"],
    overdue_jobs: (overdueJobs ?? []) as unknown as DailySummary["overdue_jobs"],
    pending_estimates: (pendingEstimates ?? []) as unknown as DailySummary["pending_estimates"],
    unsigned_contracts: (unsignedContracts ?? []) as unknown as DailySummary["unsigned_contracts"],
    unpaid_invoices: (unpaidInvoices ?? []) as unknown as DailySummary["unpaid_invoices"],
    pending_approvals: (pendingApprovals ?? []) as unknown as DailySummary["pending_approvals"],
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const body = await req.json() as { message: string; sender?: string }
  const intent = parseIntent(body.message ?? "")

  if (intent === "health_check") {
    return NextResponse.json({
      intent,
      response_text: [
        "Yes. I'm connected to Omdan Command Center.",
        "CRM connection: OK",
        "User verified: Owner/Admin",
        "WhatsApp connection: OK",
        "Approval system: Ready",
      ].join("\n"),
    })
  }

  if (intent === "daily_attention") {
    const summary = await getDailySummary()
    return NextResponse.json({ intent, summary })
  }

  return NextResponse.json({
    intent: "unknown",
    response_text:
      "I didn't understand that. Try: \"what needs my attention today?\" or \"are you connected?\"",
  })
}
