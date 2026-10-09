// Funnel metrics for the Ad Advisor: Meta's numbers (spend, leads, CTR…)
// joined with what the CRM knows happened to each lead (contacted, booked,
// NPG/PNS/Other, sold, revenue).
//
// Fairness rules baked in here, so neither the rules engine nor Claude can
// judge an ad on immature data:
//   - cost per appointment only counts leads ≥ appointment_maturity_days old
//   - cost per sale only counts leads ≥ sale_maturity_days old
//     (below that → status "too_early", value null)
//   - contact rate only counts a lead as "not reached" after ≥ min_call_attempts;
//     never-called leads are a follow-up problem, not an ad problem.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AdSettings } from "@/lib/meta-ads-settings"
import { regionFor } from "@/lib/meta-ads-settings"
import { attemptStatsFor } from "@/lib/call-attempts"

export type Level = "campaign" | "adset" | "ad"

export interface LeadFact {
  id: string
  date: string                // lead day in the ad account's timezone
  campaign_id: string | null
  adset_id: string | null
  ad_id: string | null
  attribution: string | null
  attempts: number
  attempts_estimated: boolean
  reached: boolean
  appointment: boolean
  outcome: string | null      // NPG | PNS | OTHER | SOLD
  sold: boolean
  revenue: number
  city: string | null
  region: string
}

export interface DayRow {
  entity_id: string
  date: string
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  leads: number
  video_3s_views: number
}

export interface Matured {
  value: number | null
  status: "ok" | "too_early" | "none"   // none = mature leads/spend but zero events yet
  maturity_days: number
  mature_spend: number
  mature_leads: number
  events: number
}

export interface ContactStats {
  eligible: number                    // reached, or called ≥ min attempts
  reached: number
  rate: number | null
  not_reached_after_attempts: number
  not_yet_attempted: number           // 0 calls — a follow-up/team issue
  under_attempted: number             // 1..min-1 calls, not reached yet
  estimated: number                   // leads whose attempts are estimated (pre-tracking)
}

export interface EntityMetrics {
  entity_id: string
  level: Level
  name: string
  status: string | null
  days_running: number
  spend: number
  impressions: number
  link_clicks: number
  leads_meta: number
  cpl: number | null
  ctr: number | null                  // link CTR %
  hook_rate: number | null            // 3-sec views / impressions %
  frequency_7d: number | null
  crm_leads: number
  appointments: number
  cost_per_appointment: Matured
  cost_per_sale: Matured
  contact: ContactStats
  outcomes: { npg: number; pns: number; other: number; sold: number }
  npg_share_mature: number | null
  revenue: number
  sample: { leads: number; appointments: number; sales: number; days: number; spend: number }
}

// ── Dates ──────────────────────────────────────────────────────────────────

export function dateInTz(d: Date | string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d))
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const inRange = (d: string, start: string, end: string) => d >= start && d <= end

export function leadsFor(level: Level, id: string, leads: LeadFact[]): LeadFact[] {
  const key = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id"
  return leads.filter((l) => l[key] === id)
}

// ── Pure computation ───────────────────────────────────────────────────────

function matured(rows: DayRow[], leads: LeadFact[], period: { start: string; end: string }, today: string, days: number, isEvent: (l: LeadFact) => boolean): Matured {
  const cutoff = addDays(today, -days)
  const end = period.end < cutoff ? period.end : cutoff
  if (end < period.start) {
    return { value: null, status: "too_early", maturity_days: days, mature_spend: 0, mature_leads: 0, events: 0 }
  }
  const mature_spend = rows.filter((r) => inRange(r.date, period.start, end)).reduce((s, r) => s + r.spend, 0)
  const matureLeads = leads.filter((l) => inRange(l.date, period.start, end))
  const events = matureLeads.filter(isEvent).length
  if (mature_spend <= 0 && matureLeads.length === 0) {
    return { value: null, status: "too_early", maturity_days: days, mature_spend: 0, mature_leads: 0, events: 0 }
  }
  if (events === 0) {
    return { value: null, status: "none", maturity_days: days, mature_spend: round(mature_spend), mature_leads: matureLeads.length, events: 0 }
  }
  return { value: round(mature_spend / events), status: "ok", maturity_days: days, mature_spend: round(mature_spend), mature_leads: matureLeads.length, events }
}

export function contactStats(leads: LeadFact[], minAttempts: number, today: string): ContactStats {
  // A lead from today hasn't had a fair chance to be called yet
  const pool = leads.filter((l) => l.date < today)
  let eligible = 0, reached = 0, notReached = 0, notYet = 0, under = 0, estimated = 0
  for (const l of pool) {
    if (l.attempts_estimated) estimated++
    if (l.reached) { eligible++; reached++; continue }
    if (l.attempts === 0) { notYet++; continue }
    if (l.attempts < minAttempts) { under++; continue }
    eligible++; notReached++
  }
  return {
    eligible, reached, rate: eligible ? round(reached / eligible, 3) : null,
    not_reached_after_attempts: notReached, not_yet_attempted: notYet, under_attempted: under, estimated,
  }
}

export function computeEntityMetrics(args: {
  entity: { id: string; level: Level; name: string; effective_status: string | null; frequency_7d: number | null }
  rows: DayRow[]                 // this entity's daily rows (any range; filtered to the period here)
  firstSpendDate: string | null  // first day this entity ever spent
  leads: LeadFact[]              // leads attributed to this entity (any date)
  settings: AdSettings
  period: { start: string; end: string }
  today: string
}): EntityMetrics {
  const { entity, settings, period, today } = args
  const rows = args.rows.filter((r) => inRange(r.date, period.start, period.end))
  const leads = args.leads.filter((l) => inRange(l.date, period.start, period.end))

  const spend = rows.reduce((s, r) => s + r.spend, 0)
  const impressions = rows.reduce((s, r) => s + r.impressions, 0)
  const link_clicks = rows.reduce((s, r) => s + r.link_clicks, 0)
  const leads_meta = rows.reduce((s, r) => s + r.leads, 0)
  const v3 = rows.reduce((s, r) => s + r.video_3s_views, 0)

  const appointments = leads.filter((l) => l.appointment).length
  const sales = leads.filter((l) => l.sold).length
  const revenue = leads.reduce((s, l) => s + l.revenue, 0)

  const apptMature = leads.filter((l) => l.date <= addDays(today, -settings.appointment_maturity_days))
  const withOutcome = apptMature.filter((l) => l.outcome)
  const npg = (ls: LeadFact[]) => ls.filter((l) => l.outcome === "NPG").length

  const days_running = args.firstSpendDate
    ? Math.max(0, Math.round((new Date(`${today}T12:00:00Z`).getTime() - new Date(`${args.firstSpendDate}T12:00:00Z`).getTime()) / 86400000) + 1)
    : 0

  return {
    entity_id: entity.id,
    level: entity.level,
    name: entity.name,
    status: entity.effective_status,
    days_running,
    spend: round(spend),
    impressions,
    link_clicks,
    leads_meta,
    cpl: leads_meta ? round(spend / leads_meta) : null,
    ctr: impressions ? round((link_clicks / impressions) * 100, 2) : null,
    hook_rate: impressions && v3 ? round((v3 / impressions) * 100, 1) : null,
    frequency_7d: entity.frequency_7d,
    crm_leads: leads.length,
    appointments,
    cost_per_appointment: matured(rows, leads, period, today, settings.appointment_maturity_days, (l) => l.appointment),
    cost_per_sale: matured(rows, leads, period, today, settings.sale_maturity_days, (l) => l.sold),
    contact: contactStats(leads, settings.min_call_attempts, today),
    outcomes: {
      npg: npg(leads),
      pns: leads.filter((l) => l.outcome === "PNS").length,
      other: leads.filter((l) => l.outcome === "OTHER").length,
      sold: sales,
    },
    npg_share_mature: withOutcome.length >= 5 ? round(npg(withOutcome) / withOutcome.length, 2) : null,
    revenue: round(revenue),
    sample: { leads: Math.max(leads.length, leads_meta), appointments, sales, days: days_running, spend: round(spend) },
  }
}

export interface RegionRow {
  region: string
  cities: Record<string, number>
  leads: number
  appointments: number
  sales: number
  spend_share: number
  cost_per_appointment: Matured
  cost_per_sale: Matured
}

/** Leads / cost per appointment / cost per sale by region. Spend is split by each region's share of leads. */
export function regionBreakdown(rows: DayRow[], leads: LeadFact[], settings: AdSettings, period: { start: string; end: string }, today: string): RegionRow[] {
  const inPeriod = leads.filter((l) => inRange(l.date, period.start, period.end))
  const total = inPeriod.length
  const byRegion = new Map<string, LeadFact[]>()
  for (const l of inPeriod) byRegion.set(l.region, [...(byRegion.get(l.region) ?? []), l])
  return [...byRegion.entries()].map(([region, ls]) => {
    const share = total ? ls.length / total : 0
    const scaled = rows.map((r) => ({ ...r, spend: r.spend * share }))
    const cities: Record<string, number> = {}
    for (const l of ls) if (l.city) cities[l.city] = (cities[l.city] ?? 0) + 1
    return {
      region, cities, leads: ls.length,
      appointments: ls.filter((l) => l.appointment).length,
      sales: ls.filter((l) => l.sold).length,
      spend_share: round(share, 3),
      cost_per_appointment: matured(scaled, ls, period, today, settings.appointment_maturity_days, (l) => l.appointment),
      cost_per_sale: matured(scaled, ls, period, today, settings.sale_maturity_days, (l) => l.sold),
    }
  }).sort((a, b) => b.leads - a.leads)
}

export function round(n: number, digits = 2): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

// ── Loading the CRM side ───────────────────────────────────────────────────

const SOLD_STATUSES = new Set(["Approved", "Scheduled", "In Progress", "Completed", "Paid"])

function digits(p: string | null | undefined) {
  const d = (p ?? "").replace(/\D/g, "")
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d
}

export async function loadLeadFacts(service: SupabaseClient, opts: { sinceDays: number; tz: string; settings: AdSettings }): Promise<{ leads: LeadFact[]; trackingSince: string | null; unattributed: number }> {
  const since = new Date(Date.now() - opts.sinceDays * 86400000).toISOString()
  const mainCalendar = process.env.META_LEADS_MAIN_CALENDAR_ID ?? null

  const { data: metaLeads } = await service
    .from("meta_leads")
    .select("id, created_at, phone, city, address, list, last_outcome, scheduled_at, calendar_id, missed_call_count, meta_campaign_id, meta_adset_id, meta_ad_id, attribution")
    .gte("created_at", since)
    .limit(5000)
  const ml = metaLeads ?? []
  const ids = ml.map((l) => l.id)

  const [{ data: firstAttempt }, attemptsRes, customersRes] = await Promise.all([
    service.from("meta_lead_call_attempts").select("attempted_at").order("attempted_at", { ascending: true }).limit(1),
    ids.length ? service.from("meta_lead_call_attempts").select("meta_lead_id, attempted_at, answered").in("meta_lead_id", ids) : Promise.resolve({ data: [] as { meta_lead_id: string; attempted_at: string; answered: boolean | null }[] }),
    service.from("customers").select("id, phone, address, status, lead_outcome, meta_lead_id").gte("created_at", since).limit(5000),
  ])
  const trackingSince = firstAttempt?.[0]?.attempted_at ?? null

  const attemptsBy = new Map<string, { attempted_at: string; answered: boolean | null }[]>()
  for (const a of attemptsRes.data ?? []) attemptsBy.set(a.meta_lead_id, [...(attemptsBy.get(a.meta_lead_id) ?? []), a])

  const customers = customersRes.data ?? []
  const custByMeta = new Map(customers.filter((c) => c.meta_lead_id).map((c) => [c.meta_lead_id as string, c]))
  const custByPhone = new Map(customers.filter((c) => c.phone).map((c) => [digits(c.phone), c]))

  const custIds = customers.map((c) => c.id)
  const revenueBy = new Map<string, number>()
  if (custIds.length) {
    const { data: pays } = await service.from("payments").select("customer_id, amount").in("customer_id", custIds)
    for (const p of pays ?? []) revenueBy.set(p.customer_id, (revenueBy.get(p.customer_id) ?? 0) + Number(p.amount))
  }

  const leads: LeadFact[] = ml.map((l) => {
    const c = custByMeta.get(l.id) ?? (l.phone ? custByPhone.get(digits(l.phone)) : undefined)
    const stats = attemptStatsFor(l, attemptsBy.get(l.id) ?? [], trackingSince)
    const revenue = c ? revenueBy.get(c.id) ?? 0 : 0
    const appointment = l.list === "scheduled" || l.last_outcome === "answered_scheduled" || (!!l.scheduled_at && !!mainCalendar && l.calendar_id === mainCalendar)
    const { city, region } = regionFor(c?.address ?? l.address ?? l.city, opts.settings.regions)
    return {
      id: l.id,
      date: dateInTz(l.created_at, opts.tz),
      campaign_id: l.meta_campaign_id, adset_id: l.meta_adset_id, ad_id: l.meta_ad_id,
      attribution: l.attribution,
      attempts: stats.attempts, attempts_estimated: stats.estimated,
      reached: stats.reached || appointment,
      appointment,
      outcome: c?.lead_outcome ?? null,
      sold: c?.lead_outcome === "SOLD" || (!!c && SOLD_STATUSES.has(c.status)) || revenue > 0,
      revenue,
      city, region,
    }
  })

  return { leads, trackingSince, unattributed: leads.filter((l) => !l.campaign_id && !l.ad_id).length }
}
