// Every lead that comes in — Facebook/Instagram instant form, the website
// booking form (incl. the AI phone receptionist), Google Ads lead forms, or
// one added by hand on Meta Lead Jobs — gets a lead card (customers row, New
// Lead) right away, with everything the person filled in. Before, a card was
// only made once the appointment was confirmed on the Calendar page.
//
// Same person already in the CRM (matched by phone, else email) → that card
// is reused: empty fields are filled in, nothing already there is overwritten,
// and the new form answers are added to its notes.

import type { SupabaseClient } from "@supabase/supabase-js"
import { copyAttributionToCustomer } from "@/lib/meta-attribution"

export interface LeadCardInput {
  name:              string
  phone?:            string | null
  email?:            string | null
  address?:          string | null   // street address; city is added if it's not already in it
  city?:             string | null
  /** customers.lead_source value: "facebook" | "google" | "website" | "phone_call" | … */
  leadSource:        string
  serviceType?:      string | null
  /** Form answers etc., one per line — saved in the card's notes */
  details?:          string[]
  /** Heading for the notes, e.g. "Facebook instant form — Oct 30, 2026" */
  heading:           string
  metaLeadId?:       string | null
  calendarEventId?:  string | null
}

const digits = (p: string | null | undefined) => (p ?? "").replace(/\D/g, "").slice(-10)

async function ownerUserId(service: SupabaseClient): Promise<string | null> {
  const { data } = await service.from("team_members").select("user_id").eq("role", "owner").eq("status", "active").limit(1).maybeSingle()
  return data?.user_id ?? null
}

export async function upsertLeadCard(service: SupabaseClient, input: LeadCardInput, userId?: string | null): Promise<{ customerId: string; created: boolean } | null> {
  const phone = input.phone?.trim() || null
  const email = input.email?.trim().toLowerCase() || null
  const city = input.city?.trim() || null
  let address = input.address?.trim() || null
  if (address && city && !address.toLowerCase().includes(city.toLowerCase())) address = `${address}, ${city}`
  if (!address && city) address = city
  const noteBlock = [input.heading, ...(input.details ?? []).filter(Boolean)].join("\n")

  // Same person already on file?
  let existing: { id: string; name: string | null; phone: string | null; email: string | null; address: string | null; notes: string | null; calendar_event_id: string | null; lead_source: string | null } | null = null
  if (phone && digits(phone).length >= 10) {
    const { data } = await service.from("customers").select("id, name, phone, email, address, notes, calendar_event_id, lead_source").not("phone", "is", null)
    existing = (data ?? []).find((c) => digits(c.phone) === digits(phone)) ?? null
  }
  if (!existing && email) {
    const { data } = await service.from("customers").select("id, name, phone, email, address, notes, calendar_event_id, lead_source").ilike("email", email).limit(1)
    existing = data?.[0] ?? null
  }

  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!existing.phone && phone) patch.phone = phone
    if (!existing.email && email) patch.email = email
    // A street address beats one that is only a city ("Indio" from a Facebook form)
    if (address && (!existing.address || (!/\d/.test(existing.address) && /\d/.test(address)))) patch.address = address
    if (!existing.lead_source && input.leadSource) patch.lead_source = input.leadSource
    if (!existing.calendar_event_id && input.calendarEventId) patch.calendar_event_id = input.calendarEventId
    if (!(existing.notes ?? "").includes(input.heading)) patch.notes = [existing.notes, noteBlock].filter(Boolean).join("\n\n")
    if (Object.keys(patch).length) await service.from("customers").update(patch).eq("id", existing.id)
    if (input.metaLeadId) await copyAttributionToCustomer(service, input.metaLeadId, existing.id).catch(() => {})
    return { customerId: existing.id, created: false }
  }

  const uid = userId ?? (await ownerUserId(service))
  if (!uid) return null
  const { data: created, error } = await service.from("customers").insert({
    user_id:           uid,
    name:              input.name.trim() || (phone ? `Lead ${phone}` : "New lead"),
    phone,
    email,
    address,
    service_type:      input.serviceType ?? null,
    lead_source:       input.leadSource,
    status:            "New Lead",
    notes:             noteBlock,
    calendar_event_id: input.calendarEventId ?? null,
  }).select("id").single()
  if (error || !created) {
    console.error("[lead-card] couldn't create the lead card:", error?.message)
    return null
  }
  if (input.metaLeadId) await copyAttributionToCustomer(service, input.metaLeadId, created.id).catch(() => {})
  return { customerId: created.id, created: true }
}

export function todayLabel(d = new Date()): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })
}
