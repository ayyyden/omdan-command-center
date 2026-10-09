// Telegram alerts for the Ad Advisor, via Lia.
//   - Only critical/urgent rule hits alert; the same rule+entity alerts once per LA day.
//   - Quiet hours (default 21:00–07:00 LA): urgent alerts are held and sent
//     together when quiet hours end. Critical ones (money burning, account
//     disabled, payment failed, token broken) go out immediately.

import type { SupabaseClient } from "@supabase/supabase-js"
import { notifyLiaAction } from "@/lib/lia-notifications"
import type { AdSettings } from "@/lib/meta-ads-settings"
import { CRITICAL_RULES, isQuietHour, laHour, nextQuietEnd, type RuleHit } from "@/lib/meta-ads-rules"

const laDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d)

export interface AlertResult { sent: number; held: number; duplicates: number }

export async function processAlerts(
  service: SupabaseClient,
  hits: RuleHit[],
  settings: AdSettings,
  now = new Date(),
  send: (text: string) => Promise<boolean> = (text) => notifyLiaAction({ text }),
): Promise<AlertResult> {
  const quiet = isQuietHour(laHour(now), settings.quiet_start_hour, settings.quiet_end_hour)
  const day = laDate(now)
  let sent = 0, held = 0, duplicates = 0

  for (const h of hits.filter((x) => x.severity === "critical" || x.severity === "urgent")) {
    const critical = CRITICAL_RULES.has(h.rule)
    const key = `${h.rule}:${h.entity_id}:${day}`
    const holdUntil = quiet && !critical ? nextQuietEnd(now, settings.quiet_end_hour) : null

    const { data: inserted, error } = await service
      .from("meta_ad_alerts")
      .upsert({ key, entity_id: h.entity_id, severity: critical ? "critical" : "urgent", message: h.message, held_until: holdUntil },
        { onConflict: "key", ignoreDuplicates: true })
      .select("id")
    if (error) { console.error("[meta-ads-alerts] queue failed:", error.message); continue }
    if (!inserted?.length) { duplicates++; continue }

    if (holdUntil) { held++; continue }
    const ok = await send(`${critical ? "🚨" : "⚠️"} Ad alert: ${h.message}\nOpen the Ad Advisor in the CRM for details.`)
    if (ok) {
      await service.from("meta_ad_alerts").update({ sent_at: new Date().toISOString() }).eq("id", inserted[0].id)
      sent++
    }
  }
  return { sent, held, duplicates }
}

/** Sends alerts held during quiet hours once they're over, as one message. */
export async function flushHeldAlerts(
  service: SupabaseClient,
  settings: AdSettings,
  now = new Date(),
  send: (text: string) => Promise<boolean> = (text) => notifyLiaAction({ text }),
): Promise<number> {
  if (isQuietHour(laHour(now), settings.quiet_start_hour, settings.quiet_end_hour)) return 0
  const { data: due } = await service
    .from("meta_ad_alerts")
    .select("id, message")
    .is("sent_at", null)
    .not("held_until", "is", null)
    .lte("held_until", now.toISOString())
    .order("created_at")
  if (!due?.length) return 0
  const text = `⚠️ Ad alerts from overnight (${due.length}):\n${due.map((a) => `• ${a.message}`).join("\n")}\nOpen the Ad Advisor in the CRM for details.`
  if (!(await send(text))) return 0
  await service.from("meta_ad_alerts").update({ sent_at: new Date().toISOString() }).in("id", due.map((a) => a.id))
  return due.length
}
