import type { DailySummary } from "./types"

function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000))
}

function fmtMoney(amount: number | null | undefined): string {
  if (!amount) return "$0"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount)
}

function fmtTime(time: string | null | undefined): string {
  if (!time) return "TBD"
  const [h, m] = time.split(":")
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`
}

export function formatDailySummary(s: DailySummary): string {
  const dateLabel = new Date(s.date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  })

  const lines: string[] = [`Here's what needs your attention — ${dateLabel}:`, ""]

  // Today's jobs
  lines.push(`📋 TODAY'S JOBS (${s.today_jobs.length})`)
  if (s.today_jobs.length === 0) {
    lines.push("  No jobs scheduled today.")
  } else {
    s.today_jobs.forEach(j => {
      lines.push(`  • ${fmtTime(j.scheduled_time)} — ${j.customer?.name ?? "Unknown"} — ${j.title}`)
    })
  }
  lines.push("")

  // Overdue jobs
  lines.push(`⚠️ OVERDUE JOBS (${s.overdue_jobs.length})`)
  if (s.overdue_jobs.length === 0) {
    lines.push("  All clear.")
  } else {
    s.overdue_jobs.forEach(j => {
      const d = daysSince(j.scheduled_date)
      lines.push(`  • ${j.customer?.name ?? "Unknown"} — ${j.title} — ${d}d overdue (${j.status})`)
    })
  }
  lines.push("")

  // Pending estimates
  lines.push(`📝 PENDING ESTIMATES (${s.pending_estimates.length})`)
  if (s.pending_estimates.length === 0) {
    lines.push("  No estimates awaiting response.")
  } else {
    s.pending_estimates.forEach(e => {
      const d = daysSince(e.created_at)
      lines.push(`  • ${fmtMoney(e.total)} — ${e.customer?.name ?? "Unknown"} — sent ${d}d ago`)
    })
  }
  lines.push("")

  // Unsigned contracts
  lines.push(`📄 UNSIGNED CONTRACTS (${s.unsigned_contracts.length})`)
  if (s.unsigned_contracts.length === 0) {
    lines.push("  No contracts awaiting signature.")
  } else {
    s.unsigned_contracts.forEach(c => {
      const d = daysSince(c.sent_at)
      const tpl = c.contract_template?.name ?? "Contract"
      lines.push(`  • ${c.recipient_email ?? "Customer"} — ${tpl} — sent ${d}d ago`)
    })
  }
  lines.push("")

  // Unpaid invoices
  lines.push(`💰 UNPAID INVOICES (${s.unpaid_invoices.length})`)
  if (s.unpaid_invoices.length === 0) {
    lines.push("  All invoices paid.")
  } else {
    s.unpaid_invoices.forEach(inv => {
      const customer = inv.job?.customer?.name ?? "Unknown"
      const due = inv.due_date ? `due ${inv.due_date}` : "no due date"
      lines.push(`  • ${fmtMoney(inv.amount)} — ${customer} — ${due}`)
    })
  }
  lines.push("")

  // Pending approvals
  lines.push(`⏳ PENDING APPROVALS (${s.pending_approvals.length})`)
  if (s.pending_approvals.length === 0) {
    lines.push("  No pending approvals.")
  } else {
    s.pending_approvals.forEach(a => {
      lines.push(`  • [${a.id.slice(0, 8)}] ${a.action_summary}`)
    })
  }

  return lines.join("\n")
}
