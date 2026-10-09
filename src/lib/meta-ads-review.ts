// The Ad Advisor's review: daily (yesterday, only campaigns with meaningful
// change or their first full day), weekly (last 7 full days, Mondays) and
// monthly (previous month, on the 1st). The deterministic rules flag
// problems; Claude turns numbers + rule hits + past action outcomes into a
// verdict and concrete next steps per campaign/ad, with a confidence level.
// Guards are re-applied to Claude's answer: no pause/scale without enough
// data, and appointment/sale metrics below maturity are passed as "too early".

import type { SupabaseClient } from "@supabase/supabase-js"
import { AI_MODEL, createAiClient } from "@/lib/bank-review"
import { activeEntities, last7, loadAdData, metricsFor, type AdData, type StoredEntity } from "@/lib/meta-ads-data"
import { addDays, regionBreakdown, type DayRow, type EntityMetrics } from "@/lib/meta-ads-metrics"
import { canJudge, evaluateEntity, type RuleHit } from "@/lib/meta-ads-rules"

export type Period = "daily" | "weekly" | "monthly"

const VERDICTS = ["scale", "keep", "watch", "fix", "pause"] as const
const ACTION_TYPES = ["creative_refresh", "new_test", "form_fix", "audience", "budget_up", "budget_down", "pause", "follow_up", "tracking"] as const

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "entities", "account_actions"],
  properties: {
    summary: { type: "string", description: "2-4 plain sentences: what happened and the single most important thing to do." },
    entities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["entity_id", "verdict", "confidence", "reason", "actions"],
        properties: {
          entity_id: { type: "string" },
          verdict: { type: "string", enum: [...VERDICTS] },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          reason: { type: "string", description: "One or two sentences citing the numbers and sample size." },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "text", "urgency"],
              properties: {
                type: { type: "string", enum: [...ACTION_TYPES] },
                text: { type: "string", description: "A specific instruction Edan can carry out today." },
                urgency: { type: "string", enum: ["urgent", "normal", "low"] },
              },
            },
          },
        },
      },
    },
    account_actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "urgency"],
        properties: {
          type: { type: "string", enum: [...ACTION_TYPES] },
          text: { type: "string" },
          urgency: { type: "string", enum: ["urgent", "normal", "low"] },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = `You are a senior Meta (Facebook/Instagram) lead-generation media buyer advising Edan, owner of a Southern California residential landscaping and hardscape contractor (artificial turf, pavers, concrete, gravel, backyards) working in the Coachella Valley, Inland Empire and High Desert. Leads come from Meta instant lead forms and from bookings on desertgreenbuilders.com. A lead's real value is a booked in-home estimate and, later, a sale.

You get, per campaign/ad: Meta metrics, CRM funnel metrics, sample sizes, rule hits from a deterministic engine, and whether there is enough data to judge. Return a verdict per entity (scale, keep, watch, fix, pause), a confidence (low/medium/high) and concrete next actions.

Rules you must follow:
- Judge on downstream results when they are available: cost per booked appointment and cost per sale beat cost per lead. A cheap lead that never books is worse than an expensive one that sells.
- A metric with status "too_early" has NOT matured (leads are too new to have booked or bought). Never use it as evidence, never pause because of it. Say it is too early.
- "can_judge": false means too little spend or fewer than 3 days running. Then the verdict must be keep or watch, never pause or scale.
- Small samples (e.g. under ~10 leads, under 3 appointments, under 2 sales) mean low confidence and no strong verdict. State the sample in the reason.
- Budget changes: at most 20% per day, to avoid resetting Meta's learning phase. Use budget_up / budget_down only when you recommend actually changing the budget; "keep the budget as is" is not a budget action (put it in the reason, or use follow_up for a dated re-check).
- "unattributed" explains why some leads aren't tied to a campaign. Don't treat a known, already-fixed cause as an urgent tracking problem; only raise tracking if new leads keep arriving unattributed.
- Leads not yet called are a follow-up/team problem, not an ad problem. Use action type follow_up for that, never blame the ad.
- Contact-rate signals marked informational are not reliable yet; mention them only as something to watch.
- Learn from "recent_action_outcomes": what Edan already did and how metrics moved 7 days later. Don't repeat advice that didn't work; build on what did.
- Be specific. Instead of "test new creative", say which angle (before/after of a real turf or paver job, a 15-second walk-through video, a price-anchor offer, a local-proof hook naming the city), and for forms which change (add a "When do you want the project done?" or "Do you own the home?" qualifier, switch to Higher Intent, or send to the website booking page).
- One clear sentence per action. Plain words, no jargon without explanation. Don't invent numbers.`

export interface ReviewResult {
  period: Period
  period_start: string
  period_end: string
  report_id: string | null
  entities_reviewed: number
  actions: number
  skipped_reason?: string
  output?: unknown
}

function periodFor(period: Period, today: string): { start: string; end: string } {
  const yesterday = addDays(today, -1)
  if (period === "daily") return { start: yesterday, end: yesterday }
  if (period === "weekly") return { start: addDays(yesterday, -6), end: yesterday }
  const [y, m] = today.split("-").map(Number)
  const firstThis = `${y}-${String(m).padStart(2, "0")}-01`
  const prev = new Date(Date.UTC(y, m - 2, 1))
  return { start: prev.toISOString().slice(0, 10), end: addDays(firstThis, -1) }
}

const sum = (rows: DayRow[], k: keyof DayRow) => rows.reduce((s, r) => s + Number(r[k]), 0)

/** Daily reviews only cover entities where something actually changed. */
export function meaningfulChange(data: AdData, e: StoredEntity, hits: RuleHit[], day: string): string | null {
  if (hits.some((h) => h.severity !== "info")) return "rule hit"
  if (data.firstSpend.get(e.id) === day) return "first full day"
  const rows = data.rowsBy.get(e.id) ?? []
  const d = rows.filter((r) => r.date === day)
  const prior = rows.filter((r) => r.date >= addDays(day, -7) && r.date <= addDays(day, -1))
  const dSpend = sum(d, "spend"), dLeads = sum(d, "leads"), pSpend = sum(prior, "spend"), pLeads = sum(prior, "leads")
  if (pLeads >= 3 && dLeads > 0) {
    const change = Math.abs(dSpend / dLeads - pSpend / pLeads) / (pSpend / pLeads)
    if (change >= 0.3) return "cost per lead moved 30%+"
  }
  const avgLeads = pLeads / 7
  if (avgLeads >= 1 && Math.abs(dLeads - avgLeads) / avgLeads >= 0.5) return "lead volume moved 50%+"
  if (hits.some((h) => h.rule === "winner")) return "scale candidate"
  return null
}

function compact(m: EntityMetrics) {
  const mat = (x: EntityMetrics["cost_per_appointment"]) =>
    x.status === "ok" ? { value: x.value, events: x.events, mature_leads: x.mature_leads }
      : x.status === "none" ? { value: null, status: "none_yet", mature_leads: x.mature_leads, mature_spend: x.mature_spend }
      : { value: null, status: "too_early", needs_days: x.maturity_days }
  return {
    spend: m.spend, impressions: m.impressions, link_clicks: m.link_clicks, leads_meta: m.leads_meta, cpl: m.cpl,
    ctr_pct: m.ctr, hook_rate_pct: m.hook_rate, frequency_7d: m.frequency_7d,
    crm_leads: m.crm_leads, appointments: m.appointments,
    cost_per_appointment: mat(m.cost_per_appointment), cost_per_sale: mat(m.cost_per_sale),
    contact: m.contact, outcomes: m.outcomes, npg_share_mature: m.npg_share_mature, revenue: m.revenue,
  }
}

export async function runAdReview(service: SupabaseClient, period: Period, opts: { dryRun?: boolean } = {}): Promise<ReviewResult> {
  const data = await loadAdData(service, { days: period === "monthly" ? 75 : 60 })
  const range = periodFor(period, data.today)
  const base: ReviewResult = { period, period_start: range.start, period_end: range.end, report_id: null, entities_reviewed: 0, actions: 0 }

  // Entities + their rule hits
  const candidates = activeEntities(data, ["campaign", "ad"], period === "daily" ? 8 : period === "weekly" ? 14 : 40)
  const rowsFor = (e: StoredEntity) => data.rowsBy.get(e.id) ?? []
  const evaluated = candidates.map((e) => {
    const m7 = metricsFor(data, e, last7(data))
    const hits = evaluateEntity({
      metrics7: m7, rows: rowsFor(e), lifetimeSpend: data.lifetimeSpend.get(e.id) ?? 0,
      settings: data.settings, today: data.today, contactTrackingMature: data.contactTrackingMature,
    })
    return { e, m7, hits, judge: canJudge(m7, data.lifetimeSpend.get(e.id) ?? 0, data.settings) }
  })

  const chosen = period === "daily"
    ? evaluated.filter((x) => meaningfulChange(data, x.e, x.hits, range.end))
    : evaluated
  if (!chosen.length) {
    const summary = period === "daily"
      ? "No meaningful changes yesterday. Nothing to do today."
      : "No campaigns spent in this period."
    if (!opts.dryRun) {
      const { data: rep } = await service.from("meta_ad_reports").insert({ period, period_start: range.start, period_end: range.end, summary, payload: { entities: [] } }).select("id").single()
      base.report_id = rep?.id ?? null
    }
    return { ...base, skipped_reason: summary }
  }

  const { data: pastActions } = await service
    .from("meta_ad_actions")
    .select("entity_name, type, text, done_at, metrics_at_done, metrics_after_7d")
    .eq("status", "done")
    .not("metrics_after_7d", "is", null)
    .order("done_at", { ascending: false })
    .limit(20)

  const byId = new Map(data.entities.map((e) => [e.id, e]))
  const input = {
    period, range, today: data.today, account_timezone: data.tz,
    settings: {
      target_cpl: data.settings.target_cpl, target_cost_per_appointment: data.settings.target_cost_per_appointment,
      avg_job_value: data.settings.avg_job_value, appointment_maturity_days: data.settings.appointment_maturity_days,
      sale_maturity_days: data.settings.sale_maturity_days, min_call_attempts: data.settings.min_call_attempts,
    },
    contact_tracking: data.contactTrackingMature ? "reliable" : "informational only (call tracking is under 14 days old)",
    unattributed: {
      count: data.unattributed,
      known_causes: "Website bookings made before 2026-10-09 can't be tied to an ad: the ad URL parameters and the website's tag capture were added that day. Instant-form leads are matched through Meta's lead id (only possible for leads under 90 days old).",
    },
    entities: chosen.map(({ e, m7, hits, judge }) => {
      const mp = metricsFor(data, e, range)
      return {
        entity_id: e.id, level: e.level, name: e.name,
        campaign: e.campaign_id && e.level !== "campaign" ? byId.get(e.campaign_id)?.name ?? null : null,
        status: e.effective_status, daily_budget: e.daily_budget, learning_stage: e.learning_stage,
        can_judge: judge,
        sample: mp.sample,
        period_metrics: compact(mp),
        last_7_days: period === "weekly" ? undefined : compact(m7),
        rule_hits: hits.map((h) => ({ rule: h.rule, severity: h.severity, message: h.message })),
      }
    }),
    regions: period === "daily" ? undefined : regionBreakdown(
      [...data.rowsBy.values()].flat().filter((r) => data.entities.find((x) => x.id === r.entity_id)?.level === "campaign"),
      data.leads, data.settings, range, data.today,
    ),
    recent_action_outcomes: (pastActions ?? []).map((a) => ({ entity: a.entity_name, type: a.type, action: a.text, done_at: a.done_at, before: a.metrics_at_done, after_7_days: a.metrics_after_7d })),
  }

  const response = await createAiClient().messages.stream({
    model: AI_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `${period.toUpperCase()} REVIEW${period === "daily" ? " — keep it short; only entities listed changed meaningfully." : ""}\n\n${JSON.stringify(input)}`,
    }],
  }).finalMessage()

  if (response.stop_reason === "refusal") throw new Error("Ad review refused")
  const text = response.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") throw new Error("Ad review returned no output")
  const out = JSON.parse(text.text) as {
    summary: string
    entities: { entity_id: string; verdict: typeof VERDICTS[number]; confidence: "low" | "medium" | "high"; reason: string; actions: { type: string; text: string; urgency: "urgent" | "normal" | "low" }[] }[]
    account_actions: { type: string; text: string; urgency: "urgent" | "normal" | "low" }[]
  }

  // Re-apply the guards to the model's answer
  const info = new Map(chosen.map((x) => [x.e.id, x]))
  const entities = out.entities.filter((r) => info.has(r.entity_id)).map((r) => {
    const x = info.get(r.entity_id)!
    let { verdict, confidence, reason, actions } = r
    if (!x.judge && (verdict === "pause" || verdict === "scale")) {
      verdict = "watch"; confidence = "low"
      reason = `${reason} (Held at "watch": not enough spend or days yet to judge.)`
      actions = actions.filter((a) => !["pause", "budget_up", "budget_down"].includes(a.type))
    }
    if (verdict === "pause" && !x.hits.some((h) => h.verdict_hint === "pause" || h.verdict_hint === "fix")) {
      verdict = "fix"
      reason = `${reason} (Not paused: no rule backs a pause yet.)`
    }
    return { ...r, verdict, confidence, reason, actions, name: x.e.name, level: x.e.level, sample: metricsFor(data, x.e, range).sample }
  })

  base.entities_reviewed = entities.length
  if (opts.dryRun) return { ...base, output: { summary: out.summary, entities, account_actions: out.account_actions } }

  const { data: rep, error } = await service.from("meta_ad_reports").insert({
    period, period_start: range.start, period_end: range.end, summary: out.summary,
    payload: { entities, account_actions: out.account_actions, regions: input.regions ?? null, unattributed: data.unattributed },
  }).select("id").single()
  if (error || !rep) throw new Error(`Couldn't save the report: ${error?.message}`)
  base.report_id = rep.id

  const actionRows = [
    ...entities.flatMap((r) => r.actions.map((a) => ({
      report_id: rep.id, entity_id: r.entity_id, entity_level: r.level, entity_name: r.name,
      type: a.type, text: a.text, reason: r.reason, confidence: r.confidence, urgency: a.urgency,
    }))),
    ...out.account_actions.map((a) => ({
      report_id: rep.id, entity_id: null, entity_level: "account", entity_name: "Ad account",
      type: a.type, text: a.text, reason: null, confidence: null, urgency: a.urgency,
    })),
  ]
  if (actionRows.length) await service.from("meta_ad_actions").insert(actionRows)
  base.actions = actionRows.length
  return base
}
