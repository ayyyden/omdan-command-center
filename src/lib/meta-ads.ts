// Read-only Meta Marketing API client for the Ad Advisor (phase 1).
// Auth: a Business Manager System User token (META_ACCESS_TOKEN) with
// ads_read + leads_retrieval, assigned to the ad account AND the Facebook
// Page (leads_retrieval needs the Page). Account: META_AD_ACCOUNT_ID
// ("act_123…" or just the digits).

const GRAPH = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`

export class MetaApiError extends Error {
  constructor(message: string, public status: number, public code?: number, public subcode?: number) {
    super(message)
  }
}

export function metaConfigured(): boolean {
  return !!process.env.META_ACCESS_TOKEN && !!process.env.META_AD_ACCOUNT_ID
}

function accountPath(): string {
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "").trim()
  return raw.startsWith("act_") ? raw : `act_${raw}`
}

// Token problems (190 = invalid/expired, 102 = session, 200/10 = permission)
// are not worth retrying; throttling (4, 17, 32, 613) and 5xx are.
function isTransient(err: unknown): boolean {
  if (!(err instanceof MetaApiError)) return true // network error
  if (err.status >= 500) return true
  return [1, 2, 4, 17, 32, 341, 613].includes(err.code ?? -1)
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try { return await fn() } catch (err) {
      last = err
      if (!isTransient(err) || i === attempts - 1) break
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
    }
  }
  throw last
}

async function graphGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = process.env.META_ACCESS_TOKEN
  if (!token) throw new MetaApiError("META_ACCESS_TOKEN is not set", 0)
  const url = path.startsWith("http") ? new URL(path) : new URL(`${GRAPH}/${path.replace(/^\//, "")}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token)

  return withRetry(async () => {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const json = await res.json().catch(() => ({})) as { error?: { message?: string; code?: number; error_subcode?: number } }
    if (!res.ok || json.error) {
      const e = json.error ?? {}
      throw new MetaApiError(e.message ?? `Meta API ${res.status}`, res.status, e.code, e.error_subcode)
    }
    return json as T
  })
}

/** Follows paging.next until exhausted (capped). */
async function graphList<T>(path: string, params: Record<string, string>, maxPages = 40): Promise<T[]> {
  const out: T[] = []
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(path, { limit: "200", ...params })
  out.push(...page.data)
  for (let i = 1; i < maxPages && page.paging?.next; i++) {
    page = await graphGet(page.paging.next)
    out.push(...page.data)
  }
  return out
}

// ── Account ────────────────────────────────────────────────────────────────

export interface MetaAccount {
  id: string
  name: string
  account_status: number       // 1 active, 2 disabled, 3 unsettled, 7 pending risk review, 9 grace period, 101 closed
  disable_reason: number | null
  timezone_name: string
  currency: string
  spend_cap: number | null
  amount_spent: number | null
}

export const ACCOUNT_STATUS: Record<number, string> = {
  1: "active", 2: "disabled", 3: "unsettled (payment failed)", 7: "pending risk review",
  8: "pending settlement", 9: "in grace period (payment issue)", 100: "pending closure", 101: "closed",
}

export async function fetchAccount(): Promise<MetaAccount> {
  const a = await graphGet<Record<string, unknown>>(accountPath(), {
    fields: "id,name,account_status,disable_reason,timezone_name,currency,spend_cap,amount_spent",
  })
  return {
    id: String(a.id),
    name: String(a.name ?? ""),
    account_status: Number(a.account_status ?? 0),
    disable_reason: a.disable_reason != null ? Number(a.disable_reason) : null,
    timezone_name: String(a.timezone_name ?? "America/Los_Angeles"),
    currency: String(a.currency ?? "USD"),
    // spend_cap / amount_spent come back in minor units (cents) as strings
    spend_cap: a.spend_cap && Number(a.spend_cap) > 0 ? Number(a.spend_cap) / 100 : null,
    amount_spent: a.amount_spent != null ? Number(a.amount_spent) / 100 : null,
  }
}

// ── Structure ──────────────────────────────────────────────────────────────

export interface MetaEntity {
  id: string
  level: "campaign" | "adset" | "ad"
  campaign_id: string | null
  adset_id: string | null
  name: string
  status: string | null
  effective_status: string | null
  objective: string | null
  daily_budget: number | null
  lifetime_budget: number | null
  learning_stage: string | null
  thumbnail_url: string | null
  form_id: string | null
  created_time: string | null
}

const cents = (v: unknown) => (v != null && v !== "" ? Number(v) / 100 : null)

export async function fetchStructure(): Promise<MetaEntity[]> {
  const act = accountPath()
  const [campaigns, adsets, ads] = await Promise.all([
    graphList<Record<string, any>>(`${act}/campaigns`, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,created_time",
    }),
    graphList<Record<string, any>>(`${act}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,learning_stage_info,created_time",
    }),
    graphList<Record<string, any>>(`${act}/ads`, {
      fields: "id,name,campaign_id,adset_id,status,effective_status,created_time,creative{thumbnail_url,object_story_spec}",
    }),
  ])

  return [
    ...campaigns.map((c): MetaEntity => ({
      id: c.id, level: "campaign", campaign_id: c.id, adset_id: null, name: c.name,
      status: c.status ?? null, effective_status: c.effective_status ?? null, objective: c.objective ?? null,
      daily_budget: cents(c.daily_budget), lifetime_budget: cents(c.lifetime_budget),
      learning_stage: null, thumbnail_url: null, form_id: null, created_time: c.created_time ?? null,
    })),
    ...adsets.map((s): MetaEntity => ({
      id: s.id, level: "adset", campaign_id: s.campaign_id ?? null, adset_id: s.id, name: s.name,
      status: s.status ?? null, effective_status: s.effective_status ?? null, objective: null,
      daily_budget: cents(s.daily_budget), lifetime_budget: cents(s.lifetime_budget),
      learning_stage: s.learning_stage_info?.status ?? null, thumbnail_url: null, form_id: null,
      created_time: s.created_time ?? null,
    })),
    ...ads.map((a): MetaEntity => {
      const spec = a.creative?.object_story_spec ?? {}
      const formId = spec.link_data?.call_to_action?.value?.lead_gen_form_id
        ?? spec.video_data?.call_to_action?.value?.lead_gen_form_id ?? null
      return {
        id: a.id, level: "ad", campaign_id: a.campaign_id ?? null, adset_id: a.adset_id ?? null, name: a.name,
        status: a.status ?? null, effective_status: a.effective_status ?? null, objective: null,
        daily_budget: null, lifetime_budget: null, learning_stage: null,
        thumbnail_url: a.creative?.thumbnail_url ?? null, form_id: formId ? String(formId) : null,
        created_time: a.created_time ?? null,
      }
    }),
  ]
}

// ── Insights (daily, per level) ────────────────────────────────────────────

export interface MetaInsightRow {
  entity_id: string
  level: "campaign" | "adset" | "ad"
  date: string
  spend: number
  impressions: number
  reach: number
  frequency: number | null
  clicks: number
  link_clicks: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  leads: number
  video_3s_views: number
}

type ActionStat = { action_type: string; value: string }

// Lead-form leads are reported under one of these depending on API version
const LEAD_ACTIONS = ["lead", "onsite_conversion.lead_grouped", "leadgen_grouped", "offsite_conversion.fb_pixel_lead"]

export function leadsFromActions(actions: ActionStat[] | undefined): number {
  if (!actions?.length) return 0
  for (const t of LEAD_ACTIONS) {
    const hit = actions.find((a) => a.action_type === t)
    if (hit) return Number(hit.value) || 0
  }
  return 0
}

function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0 }
function numOrNull(v: unknown): number | null { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null }

export async function fetchInsights(level: "campaign" | "adset" | "ad", since: string, until: string): Promise<MetaInsightRow[]> {
  const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id"
  const rows = await graphList<Record<string, any>>(`${accountPath()}/insights`, {
    level,
    time_increment: "1",
    time_range: JSON.stringify({ since, until }),
    fields: `${idField},spend,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc,cpm,actions`,
  })
  return rows.map((r) => {
    const actions = r.actions as ActionStat[] | undefined
    return {
      entity_id: String(r[idField]),
      level,
      date: String(r.date_start),
      spend: num(r.spend),
      impressions: num(r.impressions),
      reach: num(r.reach),
      frequency: numOrNull(r.frequency),
      clicks: num(r.clicks),
      link_clicks: num(r.inline_link_clicks),
      ctr: numOrNull(r.ctr),
      cpc: numOrNull(r.cpc),
      cpm: numOrNull(r.cpm),
      leads: leadsFromActions(actions),
      video_3s_views: num(actions?.find((a) => a.action_type === "video_view")?.value),
    }
  })
}

/** Reach + frequency over a whole range (not additive from daily rows). */
export async function fetchRangeFrequency(level: "campaign" | "adset" | "ad", since: string, until: string): Promise<{ entity_id: string; reach: number; frequency: number | null }[]> {
  const idField = level === "campaign" ? "campaign_id" : level === "adset" ? "adset_id" : "ad_id"
  const rows = await graphList<Record<string, any>>(`${accountPath()}/insights`, {
    level,
    time_range: JSON.stringify({ since, until }),
    fields: `${idField},reach,frequency`,
  })
  return rows.map((r) => ({ entity_id: String(r[idField]), reach: num(r.reach), frequency: numOrNull(r.frequency) }))
}

// ── Lead → ad ──────────────────────────────────────────────────────────────

export interface LeadAdInfo { ad_id: string | null; adset_id: string | null; campaign_id: string | null; form_id: string | null; created_time: string | null }

export async function fetchLeadAd(leadgenId: string): Promise<LeadAdInfo> {
  const l = await graphGet<Record<string, any>>(leadgenId, { fields: "ad_id,adset_id,campaign_id,form_id,created_time" })
  return {
    ad_id: l.ad_id ?? null, adset_id: l.adset_id ?? null, campaign_id: l.campaign_id ?? null,
    form_id: l.form_id ?? null, created_time: l.created_time ?? null,
  }
}

// ── Health ─────────────────────────────────────────────────────────────────

export interface MetaHealth {
  ok: boolean
  account: MetaAccount | null
  problems: { code: string; message: string; critical: boolean }[]
}

const REQUIRED_SCOPES = ["ads_read", "leads_retrieval"]

export async function checkHealth(): Promise<MetaHealth> {
  const problems: MetaHealth["problems"] = []
  if (!metaConfigured()) {
    return { ok: false, account: null, problems: [{ code: "not_configured", message: "Meta isn't connected yet: META_ACCESS_TOKEN and META_AD_ACCOUNT_ID are not set.", critical: false }] }
  }
  const token = process.env.META_ACCESS_TOKEN!

  try {
    const dbg = await graphGet<{ data: { is_valid: boolean; expires_at?: number; scopes?: string[]; error?: { message?: string } } }>(
      "debug_token", { input_token: token },
    )
    if (!dbg.data.is_valid) {
      problems.push({ code: "token_invalid", message: `The Meta access token is no longer valid${dbg.data.error?.message ? `: ${dbg.data.error.message}` : ""}.`, critical: true })
    } else {
      const missing = REQUIRED_SCOPES.filter((s) => !(dbg.data.scopes ?? []).includes(s))
      if (missing.length) problems.push({ code: "missing_permissions", message: `The token is missing: ${missing.join(", ")}.`, critical: false })
      if (dbg.data.expires_at && dbg.data.expires_at > 0 && dbg.data.expires_at * 1000 - Date.now() < 7 * 86400000) {
        problems.push({ code: "token_expiring", message: "The Meta access token expires within 7 days. Use a System User token that never expires.", critical: false })
      }
    }
  } catch (err) {
    const e = err as MetaApiError
    problems.push({ code: e.code === 190 ? "token_invalid" : "token_check_failed", message: `Couldn't verify the Meta token: ${e.message}`, critical: e.code === 190 })
  }

  let account: MetaAccount | null = null
  if (!problems.some((p) => p.code === "token_invalid")) {
    try {
      account = await fetchAccount()
      if (account.account_status === 2 || account.account_status === 101) {
        problems.push({ code: "account_disabled", message: `The ad account is ${ACCOUNT_STATUS[account.account_status]}.`, critical: true })
      } else if ([3, 8, 9].includes(account.account_status)) {
        problems.push({ code: "payment_failed", message: `The ad account is ${ACCOUNT_STATUS[account.account_status]}. Ads may stop delivering.`, critical: true })
      } else if (account.account_status === 7) {
        problems.push({ code: "account_review", message: "The ad account is pending a Meta risk review.", critical: false })
      }
      if (account.spend_cap && account.amount_spent != null && account.amount_spent >= account.spend_cap * 0.95) {
        problems.push({ code: "spend_cap", message: `The account has spent $${account.amount_spent.toFixed(0)} of its $${account.spend_cap.toFixed(0)} spending limit.`, critical: false })
      }
    } catch (err) {
      const e = err as MetaApiError
      problems.push({ code: "account_unreachable", message: `Couldn't read the ad account: ${e.message}`, critical: e.code === 190 })
    }
  }

  return { ok: !problems.some((p) => p.critical || p.code === "missing_permissions"), account, problems }
}
