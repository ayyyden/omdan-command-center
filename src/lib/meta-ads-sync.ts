// One sync run (every 3h from Lia's scheduler):
//   health check → structure + daily insights from Meta → Quo call history →
//   7-day "after" snapshots for completed actions → rules → alerts.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  checkHealth, fetchInsights, fetchRangeFrequency, fetchStructure, metaConfigured,
  type MetaHealth,
} from "@/lib/meta-ads"
import { syncQuoCalls, type QuoSyncResult } from "@/lib/call-attempts"
import { activeEntities, last7, loadAdData, metricsFor, type AdData } from "@/lib/meta-ads-data"
import { addDays, dateInTz } from "@/lib/meta-ads-metrics"
import { evaluateEntity, healthHits, type RuleHit } from "@/lib/meta-ads-rules"
import { flushHeldAlerts, processAlerts, type AlertResult } from "@/lib/meta-ads-alerts"
import { loadSettings } from "@/lib/meta-ads-settings"

export interface SyncResult {
  configured: boolean
  health: MetaHealth
  entities: number
  insight_rows: number
  quo: QuoSyncResult | null
  snapshots: number
  hits: number
  alerts: AlertResult | null
  flushed: number
  errors: string[]
}

export async function runMetaSync(service: SupabaseClient, opts: { skipQuo?: boolean } = {}): Promise<SyncResult> {
  const errors: string[] = []
  const health = await checkHealth()
  await service.from("meta_ad_health").insert({ ok: health.ok, account: health.account, problems: health.problems })
  const settings = await loadSettings(service)

  const result: SyncResult = {
    configured: metaConfigured(), health, entities: 0, insight_rows: 0, quo: null, snapshots: 0,
    hits: 0, alerts: null, flushed: 0, errors,
  }

  const allHits: RuleHit[] = healthHits(health.problems)
  const tokenBroken = health.problems.some((p) => p.code === "token_invalid" || p.code === "account_unreachable")

  if (result.configured && !tokenBroken) {
    const tz = health.account?.timezone_name ?? "America/Los_Angeles"
    const today = dateInTz(new Date(), tz)
    try {
      // Structure
      const structure = await fetchStructure()
      const now = new Date().toISOString()
      for (let i = 0; i < structure.length; i += 500) {
        const { error } = await service.from("meta_ad_entities").upsert(
          structure.slice(i, i + 500).map((e) => ({ ...e, updated_at: now })),
          { onConflict: "id" },
        )
        if (error) errors.push(`entities: ${error.message}`)
      }
      result.entities = structure.length

      // Daily insights — 35 days on the first run, then the last 7 (Meta restates recent days)
      const { count } = await service.from("meta_ad_insights_daily").select("entity_id", { count: "exact", head: true })
      const since = addDays(today, count ? -7 : -35)
      for (const level of ["campaign", "adset", "ad"] as const) {
        const rows = await fetchInsights(level, since, today)
        for (let i = 0; i < rows.length; i += 500) {
          const { error } = await service.from("meta_ad_insights_daily").upsert(
            rows.slice(i, i + 500).map((r) => ({ ...r, updated_at: now })),
            { onConflict: "entity_id,date" },
          )
          if (error) errors.push(`insights ${level}: ${error.message}`)
        }
        result.insight_rows += rows.length

        const freq = await fetchRangeFrequency(level, addDays(today, -6), today)
        for (const f of freq) {
          await service.from("meta_ad_entities").update({ reach_7d: f.reach, frequency_7d: f.frequency }).eq("id", f.entity_id)
        }
      }
    } catch (err) {
      errors.push(`meta: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (!opts.skipQuo) {
    result.quo = await syncQuoCalls(service).catch((err) => ({ available: false, leads_checked: 0, calls_added: 0, error: String(err) }))
  }

  // Rules + snapshots need the stored data
  if (result.configured) {
    try {
      const data = await loadAdData(service)
      result.snapshots = await fillDueSnapshots(service, data)
      for (const e of activeEntities(data, ["campaign", "ad"])) {
        allHits.push(...evaluateEntity({
          metrics7: metricsFor(data, e, last7(data)),
          rows: data.rowsBy.get(e.id) ?? [],
          lifetimeSpend: data.lifetimeSpend.get(e.id) ?? 0,
          settings: data.settings,
          today: data.today,
          contactTrackingMature: data.contactTrackingMature,
        }))
      }
    } catch (err) {
      errors.push(`rules: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  result.hits = allHits.length
  result.alerts = await processAlerts(service, allHits, settings)
  result.flushed = await flushHeldAlerts(service, settings)
  return result
}

// ── Learning loop ──────────────────────────────────────────────────────────

/** Key metrics recorded on an action when it's marked Done, and again 7 days later. */
export function snapshotMetrics(data: AdData, entityId: string) {
  const e = data.entities.find((x) => x.id === entityId)
  if (!e) return null
  const m = metricsFor(data, e, last7(data))
  return {
    taken_at: new Date().toISOString(),
    window: last7(data),
    spend: m.spend, leads: m.leads_meta, cpl: m.cpl, ctr: m.ctr, frequency_7d: m.frequency_7d,
    hook_rate: m.hook_rate, appointments: m.appointments,
    cost_per_appointment: m.cost_per_appointment.value, contact_rate: m.contact.rate,
  }
}

async function fillDueSnapshots(service: SupabaseClient, data: AdData): Promise<number> {
  const { data: due } = await service
    .from("meta_ad_actions")
    .select("id, entity_id")
    .eq("status", "done")
    .is("metrics_after_7d", null)
    .lte("snapshot_due_at", new Date().toISOString())
    .limit(100)
  let n = 0
  for (const a of due ?? []) {
    const snap = a.entity_id ? snapshotMetrics(data, a.entity_id) : null
    await service.from("meta_ad_actions").update({ metrics_after_7d: snap ?? { unavailable: true } }).eq("id", a.id)
    n++
  }
  return n
}
