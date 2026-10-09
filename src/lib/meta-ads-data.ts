// Loads everything the Ad Advisor needs in one place (used by the sync job,
// the reviews and the page): stored ad structure + daily insights, the CRM
// lead facts, settings, and the account timezone.

import type { SupabaseClient } from "@supabase/supabase-js"
import { loadSettings, type AdSettings } from "@/lib/meta-ads-settings"
import {
  addDays, computeEntityMetrics, dateInTz, leadsFor, loadLeadFacts,
  type DayRow, type EntityMetrics, type LeadFact, type Level,
} from "@/lib/meta-ads-metrics"

export interface StoredEntity {
  id: string
  level: Level
  campaign_id: string | null
  adset_id: string | null
  name: string
  status: string | null
  effective_status: string | null
  daily_budget: number | null
  lifetime_budget: number | null
  learning_stage: string | null
  thumbnail_url: string | null
  frequency_7d: number | null
  created_time: string | null
}

export interface AdData {
  settings: AdSettings
  tz: string
  today: string
  entities: StoredEntity[]
  rowsBy: Map<string, DayRow[]>
  firstSpend: Map<string, string>
  lifetimeSpend: Map<string, number>
  leads: LeadFact[]
  trackingSince: string | null
  contactTrackingMature: boolean
  unattributed: number
}

export async function accountTimezone(service: SupabaseClient): Promise<string> {
  const { data } = await service.from("meta_ad_health").select("account").order("checked_at", { ascending: false }).limit(1).maybeSingle()
  const tz = (data?.account as { timezone_name?: string } | null)?.timezone_name
  return tz || "America/Los_Angeles"
}

export async function loadAdData(service: SupabaseClient, opts: { days?: number } = {}): Promise<AdData> {
  const settings = await loadSettings(service)
  const tz = await accountTimezone(service)
  const today = dateInTz(new Date(), tz)
  const since = addDays(today, -(opts.days ?? 60))

  const [{ data: entities }, { data: rows }, facts] = await Promise.all([
    service.from("meta_ad_entities").select("id, level, campaign_id, adset_id, name, status, effective_status, daily_budget, lifetime_budget, learning_stage, thumbnail_url, frequency_7d, created_time"),
    service.from("meta_ad_insights_daily").select("entity_id, date, spend, impressions, clicks, link_clicks, leads, video_3s_views").gte("date", since).limit(50000),
    loadLeadFacts(service, { sinceDays: (opts.days ?? 60) + 2, tz, settings }),
  ])

  const rowsBy = new Map<string, DayRow[]>()
  const firstSpend = new Map<string, string>()
  const lifetimeSpend = new Map<string, number>()
  for (const r of rows ?? []) {
    const row: DayRow = {
      entity_id: r.entity_id, date: r.date, spend: Number(r.spend), impressions: r.impressions, clicks: r.clicks,
      link_clicks: r.link_clicks, leads: r.leads, video_3s_views: r.video_3s_views,
    }
    rowsBy.set(r.entity_id, [...(rowsBy.get(r.entity_id) ?? []), row])
    if (row.spend > 0) {
      const f = firstSpend.get(r.entity_id)
      if (!f || row.date < f) firstSpend.set(r.entity_id, row.date)
      lifetimeSpend.set(r.entity_id, (lifetimeSpend.get(r.entity_id) ?? 0) + row.spend)
    }
  }

  const trackingDays = facts.trackingSince ? (Date.now() - new Date(facts.trackingSince).getTime()) / 86400000 : 0

  return {
    settings, tz, today,
    entities: (entities ?? []) as StoredEntity[],
    rowsBy, firstSpend, lifetimeSpend,
    leads: facts.leads,
    trackingSince: facts.trackingSince,
    contactTrackingMature: trackingDays >= 14,
    unattributed: facts.unattributed,
  }
}

export function metricsFor(data: AdData, e: StoredEntity, period: { start: string; end: string }): EntityMetrics {
  return computeEntityMetrics({
    entity: { id: e.id, level: e.level, name: e.name, effective_status: e.effective_status, frequency_7d: e.frequency_7d },
    rows: data.rowsBy.get(e.id) ?? [],
    firstSpendDate: data.firstSpend.get(e.id) ?? null,
    leads: leadsFor(e.level, e.id, data.leads),
    settings: data.settings,
    period,
    today: data.today,
  })
}

/** Entities worth looking at: anything that spent in the window. */
export function activeEntities(data: AdData, levels: Level[], sinceDays = 14): StoredEntity[] {
  const since = addDays(data.today, -sinceDays)
  return data.entities.filter((e) => levels.includes(e.level) && (data.rowsBy.get(e.id) ?? []).some((r) => r.date >= since && r.spend > 0))
}

export function last7(data: AdData) {
  return { start: addDays(data.today, -6), end: data.today }
}
