// Ad Advisor settings (single row in meta_ad_settings) + region mapping.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface AdSettings {
  target_cpl: number
  target_cost_per_appointment: number
  avg_job_value: number
  appointment_maturity_days: number
  sale_maturity_days: number
  min_call_attempts: number
  quiet_start_hour: number
  quiet_end_hour: number
  spend_no_lead_multiple: number
  cpl_spike_multiple: number
  frequency_limit: number
  ctr_drop_pct: number
  regions: Record<string, string[]>
}

// Where Omdan / Desert Green Builders works. Settings can override.
export const DEFAULT_REGIONS: Record<string, string[]> = {
  "Coachella Valley": [
    "palm springs", "cathedral city", "rancho mirage", "palm desert", "indian wells", "la quinta", "indio",
    "coachella", "desert hot springs", "thousand palms", "bermuda dunes", "thermal", "mecca", "sky valley",
    "north palm springs", "desert palms", "whitewater",
  ],
  "Inland Empire": [
    "riverside", "san bernardino", "colton", "fontana", "rialto", "moreno valley", "beaumont", "banning",
    "yucaipa", "redlands", "ontario", "rancho cucamonga", "corona", "perris", "hemet", "san jacinto", "menifee",
    "temecula", "murrieta", "jurupa valley", "highland", "loma linda", "calimesa", "cabazon", "chino", "upland",
    "grand terrace", "eastvale", "norco", "lake elsinore", "wildomar", "canyon lake", "reche canyon",
  ],
  "High Desert & Morongo": [
    "twentynine palms", "29 palms", "yucca valley", "joshua tree", "morongo valley", "victorville", "hesperia",
    "apple valley", "adelanto", "landers", "pioneertown",
  ],
}

export const DEFAULT_SETTINGS: AdSettings = {
  target_cpl: 40,
  target_cost_per_appointment: 150,
  avg_job_value: 12000,
  appointment_maturity_days: 7,
  sale_maturity_days: 30,
  min_call_attempts: 2,
  quiet_start_hour: 21,
  quiet_end_hour: 7,
  spend_no_lead_multiple: 2,
  cpl_spike_multiple: 2,
  frequency_limit: 3.5,
  ctr_drop_pct: 30,
  regions: DEFAULT_REGIONS,
}

export async function loadSettings(service: SupabaseClient): Promise<AdSettings> {
  const { data } = await service.from("meta_ad_settings").select("*").eq("id", 1).maybeSingle()
  if (!data) return DEFAULT_SETTINGS
  const n = (v: unknown, d: number) => (v == null || Number.isNaN(Number(v)) ? d : Number(v))
  const regions = data.regions && typeof data.regions === "object" && Object.keys(data.regions).length ? data.regions as Record<string, string[]> : DEFAULT_REGIONS
  return {
    target_cpl:                  n(data.target_cpl, DEFAULT_SETTINGS.target_cpl),
    target_cost_per_appointment: n(data.target_cost_per_appointment, DEFAULT_SETTINGS.target_cost_per_appointment),
    avg_job_value:               n(data.avg_job_value, DEFAULT_SETTINGS.avg_job_value),
    appointment_maturity_days:   n(data.appointment_maturity_days, 7),
    sale_maturity_days:          n(data.sale_maturity_days, 30),
    min_call_attempts:           n(data.min_call_attempts, 2),
    quiet_start_hour:            n(data.quiet_start_hour, 21),
    quiet_end_hour:              n(data.quiet_end_hour, 7),
    spend_no_lead_multiple:      n(data.spend_no_lead_multiple, 2),
    cpl_spike_multiple:          n(data.cpl_spike_multiple, 2),
    frequency_limit:             n(data.frequency_limit, 3.5),
    ctr_drop_pct:                n(data.ctr_drop_pct, 30),
    regions,
  }
}

/** City (from a city field or an address like "123 Main St, Indio, CA 92201") + region. */
export function regionFor(cityOrAddress: string | null | undefined, regions: Record<string, string[]>): { city: string | null; region: string } {
  const text = (cityOrAddress ?? "").toLowerCase()
  if (!text.trim()) return { city: null, region: "Unknown" }
  // Prefer the segment before ", CA" in an address; otherwise the whole string
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean)
  const caIdx = parts.findIndex((p) => /^(ca|california)\b/.test(p))
  const cityGuess = caIdx > 0 ? parts[caIdx - 1] : parts.length > 1 ? parts[parts.length - 2] : parts[0]
  for (const [region, cities] of Object.entries(regions)) {
    for (const c of cities) {
      if (cityGuess === c || text.includes(c)) {
        return { city: c.replace(/\b\w/g, (ch) => ch.toUpperCase()), region }
      }
    }
  }
  const zip = text.match(/\b(9\d{4})\b/)?.[1]
  if (zip) {
    const z = Number(zip)
    if (z >= 92201 && z <= 92276) return { city: cityGuess ? titleCase(cityGuess) : null, region: "Coachella Valley" }
    if ((z >= 92277 && z <= 92286) || (z >= 92301 && z <= 92395)) return { city: cityGuess ? titleCase(cityGuess) : null, region: "High Desert & Morongo" }
    if (z >= 91701 && z <= 92599) return { city: cityGuess ? titleCase(cityGuess) : null, region: "Inland Empire" }
  }
  return { city: cityGuess ? titleCase(cityGuess) : null, region: "Other" }
}

function titleCase(s: string) { return s.replace(/\b\w/g, (c) => c.toUpperCase()) }
