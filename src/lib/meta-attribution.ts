// Ties a lead to the Meta campaign / ad set / ad / form it came from.
//   1. leadgen id (instant-form leads) → Marketing API lookup
//   2. else UTM ids from the ad's URL parameters (website bookings):
//        utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}
//        &utm_content={{ad.id}}&utm_term={{adset.id}}
//   3. else "unattributed" (shown as a count on the Ad Advisor page)
// Graph only returns leads up to 90 days old — older ones are marked
// unattributed with a note instead of failing.

import type { SupabaseClient } from "@supabase/supabase-js"
import { fetchLeadAd, metaConfigured, MetaApiError } from "@/lib/meta-ads"

export interface UtmFields {
  utm_source?:   string | null
  utm_medium?:   string | null
  utm_campaign?: string | null
  utm_content?:  string | null
  utm_term?:     string | null
  fbclid?:       string | null
}

export interface Attribution {
  attribution:      "leadgen" | "utm" | "unattributed"
  meta_campaign_id: string | null
  meta_adset_id:    string | null
  meta_ad_id:       string | null
  meta_form_id:     string | null
  attribution_note: string | null
}

export const AD_URL_PARAMETERS =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}"

/** Numeric Meta lead id inside the desertleads "Meta Lead" link (or raw text). */
export function extractLeadgenId(text: string | null | undefined): string | null {
  if (!text) return null
  return text.match(/\/(\d{8,})(?:[/?#\s]|$)/)?.[1] ?? text.match(/\bleadgen[_ ]?id[=: ]+(\d{8,})/i)?.[1] ?? null
}

// Meta ids are long digit strings; an unfilled "{{ad.id}}" template or a
// hand-typed campaign name is not an id.
function metaId(v: string | null | undefined): string | null {
  const t = (v ?? "").trim()
  return /^\d{6,}$/.test(t) ? t : null
}

export function cleanUtm(u: UtmFields): UtmFields {
  const c = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null)
  return {
    utm_source: c(u.utm_source), utm_medium: c(u.utm_medium), utm_campaign: c(u.utm_campaign),
    utm_content: c(u.utm_content), utm_term: c(u.utm_term), fbclid: c(u.fbclid),
  }
}

const UNATTRIBUTED = (note: string | null): Attribution => ({
  attribution: "unattributed", meta_campaign_id: null, meta_adset_id: null, meta_ad_id: null, meta_form_id: null, attribution_note: note,
})

export async function resolveAttribution(input: { leadgenId?: string | null; utm?: UtmFields | null; leadCreatedAt?: string | null }): Promise<Attribution> {
  let note: string | null = null

  if (input.leadgenId) {
    if (!metaConfigured()) {
      note = "Meta isn't connected yet"
    } else {
      try {
        const info = await fetchLeadAd(input.leadgenId)
        if (info.ad_id || info.campaign_id) {
          return {
            attribution: "leadgen",
            meta_campaign_id: info.campaign_id, meta_adset_id: info.adset_id, meta_ad_id: info.ad_id, meta_form_id: info.form_id,
            attribution_note: null,
          }
        }
        note = "Meta returned no ad for this lead"
      } catch (err) {
        const old = input.leadCreatedAt && Date.now() - new Date(input.leadCreatedAt).getTime() > 89 * 86400000
        note = old
          ? "Older than Meta's 90-day lead limit, so it can't be looked up"
          : `Meta lookup failed: ${err instanceof MetaApiError ? err.message : String(err)}`
      }
    }
  }

  const utm = input.utm ? cleanUtm(input.utm) : null
  const campaign = metaId(utm?.utm_campaign), ad = metaId(utm?.utm_content), adset = metaId(utm?.utm_term)
  if (campaign || ad || adset) {
    return { attribution: "utm", meta_campaign_id: campaign, meta_adset_id: adset, meta_ad_id: ad, meta_form_id: null, attribution_note: note }
  }
  if (utm?.utm_source && !note) note = `Has UTM source "${utm.utm_source}" but no ad ids — set the ad's URL parameters`

  return UNATTRIBUTED(note)
}

/**
 * Resolve and save onto a meta_leads row (separately from the lead insert,
 * so lead intake never depends on the attribution columns). Never throws.
 */
export async function attributeMetaLead(
  service: SupabaseClient,
  leadId: string,
  extras: { leadgenId?: string | null; utm?: UtmFields | null } = {},
): Promise<Attribution | null> {
  const { data: lead } = await service.from("meta_leads").select("*").eq("id", leadId).single()
  if (!lead) return null

  const leadgenId = extras.leadgenId ?? lead.meta_leadgen_id ?? extractLeadgenId(lead.notes) ?? extractLeadgenId(lead.raw_paste)
  const utm = cleanUtm(extras.utm ?? lead)
  const result = await resolveAttribution({ leadgenId, utm, leadCreatedAt: lead.created_at })
  const { error } = await service.from("meta_leads").update({
    ...result,
    ...utm,
    meta_leadgen_id: leadgenId,
    attributed_at: new Date().toISOString(),
  }).eq("id", leadId)
  if (error) console.error("[meta-attribution] save failed:", error.message)
  return result
}

/** Copy a meta lead's attribution onto the customer created from it. */
export async function copyAttributionToCustomer(service: SupabaseClient, metaLeadId: string, customerId: string): Promise<void> {
  const { data: m } = await service
    .from("meta_leads")
    .select("meta_campaign_id, meta_adset_id, meta_ad_id, meta_form_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, attribution, attributed_at")
    .eq("id", metaLeadId)
    .single()
  if (!m) return
  await service.from("customers").update({ ...m, meta_lead_id: metaLeadId }).eq("id", customerId)
}
