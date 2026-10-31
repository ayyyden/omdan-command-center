// Where a lead came from, for the label on its card and the new-lead alert.
// Facebook comes from the ad's UTM tags / fbclid (or a Meta lead form id);
// Google from the "Google Ads" note the website adds when the visit had a gclid
// or utm_source=google.

export type LeadSourceKind = "facebook" | "google" | "website" | "phone" | "calendar" | "manual"

export interface LeadSourceInput {
  notes?:           string | null
  raw_paste?:       string | null
  attribution?:     string | null
  utm_source?:      string | null
  fbclid?:          string | null
  meta_leadgen_id?: string | null
}

export function leadSource(lead: LeadSourceInput): { kind: LeadSourceKind; label: string } {
  const notes = lead.notes ?? ""
  if (/Source: Phone call/i.test(notes)) return { kind: "phone", label: "📞 Phone call" }
  if (/google/i.test(lead.utm_source ?? "") || /^Google Ads\b/im.test(notes)) return { kind: "google", label: "🔍 Google ad" }
  if (lead.meta_leadgen_id || lead.attribution === "leadgen") return { kind: "facebook", label: "📘 Facebook form" }
  if (/facebook|^fb$|instagram|^ig$|meta/i.test(lead.utm_source ?? "") || lead.fbclid) return { kind: "facebook", label: "📘 Facebook ad" }
  if (/^Website booking/.test(lead.raw_paste ?? "")) return { kind: "website", label: "🌐 Website (no ad)" }
  if (/Source: Google Calendar/i.test(notes)) return { kind: "calendar", label: "📅 Added to calendar" }
  return { kind: "manual", label: "✍️ Added by hand" }
}
