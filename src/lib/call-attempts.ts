// Real call-attempt tracking for Meta leads. Before this, the only signal was
// meta_leads.missed_call_count, which counts "No Answer" presses only —
// answered calls added nothing, there was no history, and calls placed
// straight from the Quo app were never seen. Now:
//   - every outcome press (CRM button or Lia) logs a row here, and
//   - the ad sync pulls each recent lead's call history from Quo, so calls
//     made in the Quo app count too (deduped against presses within 2 min).
// Leads from before the log existed get an estimate, flagged as such.

import type { SupabaseClient } from "@supabase/supabase-js"
import { toE164 } from "@/lib/quo-client"

export type CallOutcome = "answered_scheduled" | "no_answer" | "callback_later"

const ANSWERED: ReadonlySet<string> = new Set(["answered_scheduled", "callback_later"])

/** Log one attempt. Never throws — a logging failure must not break the outcome itself. */
export async function recordCallAttempt(
  supabase: SupabaseClient,
  metaLeadId: string,
  outcome: CallOutcome,
  source: "crm" | "lia",
): Promise<void> {
  const { error } = await supabase.from("meta_lead_call_attempts").insert({
    meta_lead_id: metaLeadId,
    outcome,
    source,
    answered: ANSWERED.has(outcome),
  })
  if (error) console.error("[call-attempts] insert failed:", error.message)
}

// ── Quo call history ───────────────────────────────────────────────────────

const QUO = "https://api.quo.com/v1"

async function quoGet<T>(path: string, params: Record<string, string | string[]>): Promise<T> {
  const url = new URL(`${QUO}${path}`)
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x))
    else url.searchParams.set(k, v)
  }
  const res = await fetch(url, { headers: { Authorization: process.env.QUO_API_KEY! }, signal: AbortSignal.timeout(20000) })
  if (!res.ok) throw new Error(`Quo ${path} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`)
  return res.json() as Promise<T>
}

let cachedPhoneNumberId: string | null = null

async function quoPhoneNumberId(): Promise<string> {
  if (cachedPhoneNumberId) return cachedPhoneNumberId
  const from = process.env.QUO_FROM_NUMBER
  const { data } = await quoGet<{ data: { id: string; number?: string; phoneNumber?: string }[] }>("/phone-numbers", {})
  const match = data.find((p) => (p.number ?? p.phoneNumber) === from) ?? data[0]
  if (!match) throw new Error("No Quo phone number found on this account")
  cachedPhoneNumberId = match.id
  return match.id
}

interface QuoCall { id: string; direction?: string; status?: string; createdAt?: string; answeredAt?: string | null; duration?: number }

export interface QuoSyncResult {
  available: boolean
  leads_checked: number
  calls_added: number
  error?: string
}

/**
 * Pulls Quo call history for recent meta leads and logs calls the CRM didn't
 * already record. Outgoing calls are attempts; an incoming call or any call
 * with talk time counts as reaching the lead.
 */
export async function syncQuoCalls(service: SupabaseClient, opts: { sinceDays?: number; maxLeads?: number } = {}): Promise<QuoSyncResult> {
  if (!process.env.QUO_API_KEY) return { available: false, leads_checked: 0, calls_added: 0, error: "QUO_API_KEY is not set" }

  let phoneNumberId: string
  try { phoneNumberId = await quoPhoneNumberId() } catch (err) {
    return { available: false, leads_checked: 0, calls_added: 0, error: err instanceof Error ? err.message : String(err) }
  }

  const since = new Date(Date.now() - (opts.sinceDays ?? 45) * 86400000).toISOString()
  const { data: leads } = await service
    .from("meta_leads")
    .select("id, phone, created_at")
    .gte("created_at", since)
    .not("phone", "is", null)
    .order("created_at", { ascending: false })
    .limit(opts.maxLeads ?? 150)

  let added = 0, checked = 0
  for (const lead of leads ?? []) {
    const phone = toE164(lead.phone ?? "")
    if (!phone) continue
    checked++
    let calls: QuoCall[]
    try {
      const res = await quoGet<{ data: QuoCall[] }>("/calls", { phoneNumberId, participants: [phone], maxResults: "50" })
      calls = res.data ?? []
    } catch (err) {
      // An endpoint/plan problem shows up on the first lead — report it rather than guess.
      if (checked === 1) return { available: false, leads_checked: 0, calls_added: 0, error: err instanceof Error ? err.message : String(err) }
      continue
    }
    if (!calls.length) continue

    const { data: logged } = await service
      .from("meta_lead_call_attempts")
      .select("external_id, attempted_at, source")
      .eq("meta_lead_id", lead.id)
    const known = new Set((logged ?? []).map((r) => r.external_id).filter(Boolean))
    const presses = (logged ?? []).filter((r) => r.source !== "quo").map((r) => new Date(r.attempted_at).getTime())

    const rows = calls
      .filter((c) => c.id && !known.has(c.id) && c.createdAt && new Date(c.createdAt).getTime() >= new Date(lead.created_at).getTime() - 3600000)
      .filter((c) => !presses.some((t) => Math.abs(t - new Date(c.createdAt!).getTime()) <= 2 * 60000))
      .map((c) => ({
        meta_lead_id: lead.id,
        outcome: null,
        source: "quo",
        external_id: c.id,
        answered: c.direction === "incoming" || !!c.answeredAt || (c.duration ?? 0) > 20,
        attempted_at: c.createdAt,
      }))
    if (rows.length) {
      const { error } = await service.from("meta_lead_call_attempts").insert(rows)
      if (!error) added += rows.length
    }
    await new Promise((r) => setTimeout(r, 120)) // stay well under Quo's rate limit
  }
  return { available: true, leads_checked: checked, calls_added: added }
}

// ── Per-lead attempt stats ─────────────────────────────────────────────────

export interface AttemptStats {
  attempts: number
  reached: boolean
  estimated: boolean
}

/**
 * Attempts per lead. Leads created before logging started get an estimate
 * from the old counters (missed_call_count + 1 if an answered outcome is on
 * record), flagged `estimated`.
 */
export function attemptStatsFor(
  lead: { id: string; created_at: string; missed_call_count: number | null; last_outcome: string | null; list?: string | null },
  logged: { attempted_at: string; answered: boolean | null }[],
  trackingSince: string | null,
): AttemptStats {
  if (logged.length) {
    return { attempts: logged.length, reached: logged.some((r) => r.answered), estimated: false }
  }
  const beforeTracking = !trackingSince || new Date(lead.created_at) < new Date(trackingSince)
  const answered = ANSWERED.has(lead.last_outcome ?? "") || lead.list === "scheduled" || lead.list === "schedule_call_list"
  if (beforeTracking) {
    return { attempts: (lead.missed_call_count ?? 0) + (answered ? 1 : 0), reached: answered, estimated: true }
  }
  return { attempts: 0, reached: answered, estimated: false }
}
