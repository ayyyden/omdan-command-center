// Confirming an appointment on the Calendar page adds that person to the
// Leads page as a New Lead. Appointments arrive from three places, each with
// its own event format:
//   website bookings  "Estimate: Joycelyn R. Durk (Both)"  + Phone/Interested in/…
//   meta leads        "Dubon Diego Lead Appointment"        + Phone/Email/City/Address
//   added by hand     "appointment Lead Krystal"            + "phone number 208…"
// Never creates a duplicate: an event already turned into a lead, a CRM
// record linked to the event, or an existing customer with the same phone
// all count as "already in leads".

import type { SupabaseClient } from "@supabase/supabase-js"
import { formatPhone } from "@/lib/utils"

export interface AppointmentEvent {
  id:          string
  title:       string
  description: string | null
  location:    string | null
  start:       string | null
}

export type LeadResult =
  | { status: "created"; customerId: string; name: string }
  | { status: "existing"; customerId: string; name: string }
  | { status: "skipped"; reason: string }

const OWN_EMAILS = new Set(["omdandevelopment@gmail.com"])

function digits(phone: string | null | undefined): string {
  const d = (phone ?? "").replace(/\D/g, "")
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d
}

/** "Label: value" / "Label - value" line from an event description. */
function field(desc: string, ...labels: string[]): string | null {
  for (const label of labels) {
    const m = desc.match(new RegExp(`^\\s*${label}\\s*[:\\-]+\\s*(.+?)\\s*$`, "im"))
    if (m?.[1]) return m[1].trim()
  }
  return null
}

function findPhone(desc: string): string | null {
  const labelled = field(desc, "phone number", "phone")
  const text = labelled ?? desc
  const m = text.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)
  return m ? m[0].trim() : null
}

function cleanName(title: string): string | null {
  const name = title
    .replace(/^\s*estimate\s*:\s*/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\blead\s+appointment\b/gi, "")
    .replace(/\b(appointment|lead)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
  if (!name || /^no\s*name$/i.test(name)) return null
  return name
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function parseAppointment(ev: AppointmentEvent) {
  const desc = (ev.description ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ")
  const phone = findPhone(desc)
  const interested = field(desc, "interested in")
  const jobFromTitle = ev.title.match(/\(([^)]+)\)/)?.[1] ?? null
  const city = field(desc, "city")
  const addressLine = field(desc, "address")
  const email = field(desc, "email")?.replace(/^[-\s]+/, "") ?? null
  const extras = ["Homeowner", "Language"]
    .map((l) => { const v = field(desc, l); return v ? `${l}: ${v}` : null })
    .filter(Boolean) as string[]

  return {
    name:         cleanName(ev.title),
    phone,
    email:        email && !OWN_EMAILS.has(email.toLowerCase()) ? email : null,
    address:      ev.location || (addressLine ? (city && !addressLine.includes(city) ? `${addressLine}, ${city}` : addressLine) : null),
    service_type: interested ? titleCase(interested) : jobFromTitle ? titleCase(jobFromTitle) : null,
    lead_source:  /desertgreenbuilders/i.test(desc) ? "website" : /lead appointment$/i.test(ev.title.trim()) ? "facebook" : null,
    extras,
  }
}

export async function ensureLeadFromAppointment(
  supabase: SupabaseClient,
  userId: string,
  ev: AppointmentEvent,
): Promise<LeadResult> {
  // 1. Already turned into a lead
  const { data: linked } = await supabase.from("customers").select("id, name").eq("calendar_event_id", ev.id).maybeSingle()
  if (linked) return { status: "existing", customerId: linked.id, name: linked.name }

  // 2. The event belongs to a job / lead appointment that already has a customer
  for (const table of ["jobs", "lead_appointments"] as const) {
    const { data } = await supabase.from(table).select("customer:customers(id, name)").eq("calendar_event_id", ev.id).limit(1).maybeSingle()
    const c = (Array.isArray(data?.customer) ? data?.customer[0] : data?.customer) as { id: string; name: string } | null | undefined
    if (c) return { status: "existing", customerId: c.id, name: c.name }
  }

  // 3. Details: a linked Meta lead is the best source, then the event itself
  const parsed = parseAppointment(ev)
  const { data: meta } = await supabase.from("meta_leads").select("full_name, phone, email, address, city, notes").eq("calendar_event_id", ev.id).maybeSingle()
  const lead = {
    name:         meta?.full_name || parsed.name,
    phone:        meta?.phone || parsed.phone,
    email:        meta?.email || parsed.email,
    address:      meta?.address || parsed.address,
    service_type: parsed.service_type,
    // Website bookings land in Meta Lead Jobs too (notes say "Source: Website"),
    // so a linked meta lead only means Facebook when nothing says otherwise.
    lead_source:  parsed.lead_source
      ?? (meta ? (/website|desertgreenbuilders/i.test(meta.notes ?? "") ? "website" : "facebook") : null),
  }

  if (!lead.phone) return { status: "skipped", reason: "No phone number on this appointment, so it wasn't added to leads." }

  // 4. Same person already in the CRM (phones are stored in many formats)
  const target = digits(lead.phone)
  const { data: withPhones } = await supabase.from("customers").select("id, name, phone, calendar_event_id").not("phone", "is", null)
  const same = (withPhones ?? []).find((c) => digits(c.phone) === target)
  if (same) {
    if (!same.calendar_event_id) await supabase.from("customers").update({ calendar_event_id: ev.id }).eq("id", same.id)
    return { status: "existing", customerId: same.id, name: same.name }
  }

  // 5. New lead
  const when = ev.start ? new Date(ev.start).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" }) : null
  const notes = [
    `Added from the confirmed calendar appointment "${ev.title.trim()}"${when ? ` on ${when}` : ""}.`,
    ...parsed.extras,
  ].join("\n")

  const name = lead.name ?? `Lead ${formatPhone(lead.phone)}`
  const { data: created, error } = await supabase
    .from("customers")
    .insert({
      user_id:           userId,
      name,
      phone:             lead.phone,
      email:             lead.email,
      address:           lead.address,
      service_type:      lead.service_type,
      lead_source:       lead.lead_source,
      status:            "New Lead",
      notes,
      calendar_event_id: ev.id,
    })
    .select("id")
    .single()

  if (error || !created) return { status: "skipped", reason: `Couldn't add the lead: ${error?.message ?? "unknown error"}` }
  return { status: "created", customerId: created.id, name }
}
