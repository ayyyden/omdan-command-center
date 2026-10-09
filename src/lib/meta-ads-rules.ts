// Deterministic rules for the Ad Advisor. These — never the model — decide
// what is urgent enough to interrupt Edan on Telegram.
//
// Mandatory data guard: no kill/scale verdict until an entity has spent
// ≥ 1.5× target CPL AND has been running ≥ 3 days. Appointment/sale-based
// verdicts additionally require a mature cohort (metrics status "ok").

import type { AdSettings } from "@/lib/meta-ads-settings"
import type { DayRow, EntityMetrics, Level } from "@/lib/meta-ads-metrics"
import { addDays, round } from "@/lib/meta-ads-metrics"

export type Severity = "critical" | "urgent" | "warn" | "info"

export interface RuleHit {
  rule: string
  severity: Severity
  entity_id: string
  entity_name: string
  level: Level | "account"
  message: string
  verdict_hint?: "pause" | "scale" | "fix" | "watch"
}

/** Critical = sent even during quiet hours. */
export const CRITICAL_RULES = new Set(["money_burning", "account_disabled", "payment_failed", "token_broken"])

export function canJudge(m: Pick<EntityMetrics, "days_running">, lifetimeSpend: number, s: AdSettings): boolean {
  return lifetimeSpend >= 1.5 * s.target_cpl && m.days_running >= 3
}

const money = (n: number) => `$${n.toFixed(n < 100 ? 2 : 0)}`
const sum = (rows: DayRow[], k: keyof DayRow) => rows.reduce((s, r) => s + Number(r[k]), 0)

export function evaluateEntity(args: {
  metrics7: EntityMetrics          // last 7 days incl. today
  rows: DayRow[]                   // this entity's daily rows, ≥ 14 days back
  lifetimeSpend: number
  settings: AdSettings
  today: string                    // in the ad account's timezone
  contactTrackingMature: boolean   // ≥ 14 days of logged call attempts
}): RuleHit[] {
  const { metrics7: m, rows, settings: s, today } = args
  const hits: RuleHit[] = []
  const base = { entity_id: m.entity_id, entity_name: m.name, level: m.level }
  const active = !m.status || m.status === "ACTIVE"
  const judge = canJudge(m, args.lifetimeSpend, s)
  const byDate = (d: string) => rows.filter((r) => r.date === d)

  // 1. Money burning — spend with zero leads (critical, ignores quiet hours)
  const burnLimit = s.spend_no_lead_multiple * s.target_cpl
  const todayRows = byDate(today)
  const last3 = rows.filter((r) => r.date >= addDays(today, -2) && r.date <= today)
  if (active && sum(todayRows, "spend") >= burnLimit && sum(todayRows, "leads") === 0) {
    hits.push({ ...base, rule: "money_burning", severity: "critical", verdict_hint: "pause",
      message: `${m.name} spent ${money(sum(todayRows, "spend"))} today with 0 leads (limit ${money(burnLimit)}).` })
  } else if (active && sum(last3, "spend") >= burnLimit && sum(last3, "leads") === 0) {
    hits.push({ ...base, rule: "money_burning", severity: "critical", verdict_hint: "pause",
      message: `${m.name} spent ${money(sum(last3, "spend"))} over 3 days with 0 leads.` })
  }

  // 2. Rejected / delivery issues
  if (m.status === "DISAPPROVED" || m.status === "WITH_ISSUES") {
    hits.push({ ...base, rule: "rejected", severity: "urgent", verdict_hint: "fix",
      message: `${m.name} is ${m.status === "DISAPPROVED" ? "rejected by Meta" : "flagged with issues"} and may not be delivering.` })
  }

  // 3. CPL spike — yesterday vs its own trailing 7 days, and 7-day CPL vs target
  const yesterday = addDays(today, -1)
  const yRows = byDate(yesterday)
  const ySpend = sum(yRows, "spend"), yLeads = sum(yRows, "leads")
  const prior = rows.filter((r) => r.date >= addDays(today, -8) && r.date <= addDays(today, -2))
  const pSpend = sum(prior, "spend"), pLeads = sum(prior, "leads")
  if (judge && yLeads > 0 && ySpend >= s.target_cpl && pLeads >= 3) {
    const yCpl = ySpend / yLeads, pCpl = pSpend / pLeads
    if (yCpl > s.cpl_spike_multiple * pCpl) {
      hits.push({ ...base, rule: "cpl_spike", severity: "urgent", verdict_hint: "watch",
        message: `${m.name}: yesterday's cost per lead was ${money(yCpl)}, ${round(yCpl / pCpl, 1)}× its 7-day average of ${money(pCpl)}.` })
    }
  }
  if (judge && m.cpl != null && m.cpl > s.cpl_spike_multiple * s.target_cpl) {
    hits.push({ ...base, rule: "cpl_over_target", severity: "urgent", verdict_hint: "fix",
      message: `${m.name}: 7-day cost per lead ${money(m.cpl)} is over ${s.cpl_spike_multiple}× your ${money(s.target_cpl)} target.` })
  }

  // 4. Audience fatigue
  if (m.frequency_7d != null && m.frequency_7d > s.frequency_limit && m.spend > 0) {
    hits.push({ ...base, rule: "frequency", severity: "urgent", verdict_hint: "fix",
      message: `${m.name}: people have seen it ${m.frequency_7d.toFixed(1)} times on average this week (limit ${s.frequency_limit}). Audience is getting tired of it.` })
  }

  // 5. Creative fatigue — CTR this week vs last week
  const thisWeek = rows.filter((r) => r.date >= addDays(today, -6) && r.date <= today)
  const lastWeek = rows.filter((r) => r.date >= addDays(today, -13) && r.date <= addDays(today, -7))
  const ti = sum(thisWeek, "impressions"), li = sum(lastWeek, "impressions")
  if (ti >= 1000 && li >= 1000) {
    const tCtr = sum(thisWeek, "link_clicks") / ti, lCtr = sum(lastWeek, "link_clicks") / li
    if (lCtr > 0 && (lCtr - tCtr) / lCtr * 100 >= s.ctr_drop_pct) {
      hits.push({ ...base, rule: "ctr_drop", severity: "urgent", verdict_hint: "fix",
        message: `${m.name}: click rate fell ${round((lCtr - tCtr) / lCtr * 100, 0)}% vs last week (${(lCtr * 100).toFixed(2)}% → ${(tCtr * 100).toFixed(2)}%). The creative is wearing out.` })
    }
  }

  // 6. Cost per appointment (mature cohorts only)
  const cpa = m.cost_per_appointment
  if (judge && cpa.status === "ok" && cpa.value! > 2 * s.target_cost_per_appointment) {
    hits.push({ ...base, rule: "appointment_cost", severity: "warn", verdict_hint: "fix",
      message: `${m.name}: ${money(cpa.value!)} per booked appointment (leads ${cpa.maturity_days}+ days old), over 2× your ${money(s.target_cost_per_appointment)} target.` })
  } else if (judge && cpa.status === "none" && cpa.mature_leads >= 8) {
    hits.push({ ...base, rule: "no_appointments", severity: "warn", verdict_hint: "fix",
      message: `${m.name}: ${cpa.mature_leads} leads at least ${cpa.maturity_days} days old and not one booked appointment.` })
  }

  // 7. Lead quality — NPG share among mature leads with an outcome
  if (m.npg_share_mature != null && m.npg_share_mature >= 0.5) {
    hits.push({ ...base, rule: "npg_share", severity: "warn", verdict_hint: "fix",
      message: `${m.name}: ${Math.round(m.npg_share_mature * 100)}% of its leads with a result were NPG. The form may be attracting the wrong people.` })
  }

  // 8. Contact rate — only leads called ≥ min attempts count. Informational
  //    until call tracking has 14 days of history.
  const c = m.contact
  if (c.eligible >= 5 && c.rate != null && c.rate < 0.3) {
    hits.push({ ...base, rule: "contact_rate", severity: args.contactTrackingMature ? "warn" : "info", verdict_hint: args.contactTrackingMature ? "fix" : undefined,
      message: `${m.name}: only ${Math.round(c.rate * 100)}% of leads called ${s.min_call_attempts}+ times were reached${args.contactTrackingMature ? "" : " (call tracking is new, so this is informational only)"}. Check the form's phone question.` })
  }
  // 9. Follow-up gap — a team issue, never an ad verdict
  const pool = c.eligible + c.not_yet_attempted + c.under_attempted
  if (c.not_yet_attempted >= 3 && pool && c.not_yet_attempted / pool >= 0.3) {
    hits.push({ ...base, rule: "follow_up_gap", severity: "warn",
      message: `${c.not_yet_attempted} of ${m.name}'s leads haven't been called yet. That's a follow-up problem, not an ad problem.` })
  }

  // 10. Winner
  if (judge && m.cpl != null && m.cpl < 0.6 * s.target_cpl && m.leads_meta >= 5 && active) {
    hits.push({ ...base, rule: "winner", severity: "info", verdict_hint: "scale",
      message: `${m.name}: ${money(m.cpl)} per lead over ${m.leads_meta} leads this week, well under your ${money(s.target_cpl)} target. Candidate to scale (raise budget ≤ 20% a day).` })
  }

  return hits
}

/** Hits from the account health check (token, account status, payment). */
export function healthHits(problems: { code: string; message: string; critical: boolean }[]): RuleHit[] {
  const map: Record<string, string> = { token_invalid: "token_broken", account_disabled: "account_disabled", payment_failed: "payment_failed" }
  return problems
    .filter((p) => p.code !== "not_configured")
    .map((p) => ({
      rule: map[p.code] ?? p.code,
      severity: (map[p.code] ? "critical" : p.critical ? "urgent" : "warn") as Severity,
      entity_id: "account", entity_name: "Ad account", level: "account" as const,
      message: p.message,
    }))
}

// ── Quiet hours ────────────────────────────────────────────────────────────

export function laHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(now))
}

export function isQuietHour(hour: number, start: number, end: number): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end
}

/** Next quiet-hours end (e.g. 7:00 LA) as an ISO instant. */
export function nextQuietEnd(now: Date, endHour: number): string {
  for (let h = 0; h <= 30; h++) {
    const t = new Date(now.getTime() + h * 3600000)
    if (laHour(t) === endHour) {
      t.setUTCMinutes(0, 0, 0)
      return t.toISOString()
    }
  }
  return new Date(now.getTime() + 10 * 3600000).toISOString()
}
