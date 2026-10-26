// Scheduled estimates (meta_leads on the "scheduled" list) as the phone
// receptionist sees them: which company the appointment is with, confirming,
// rescheduling and cancelling it, the confirmation text, and placing the
// outbound confirmation calls. Used by the /api/retell/* tools, the confirm
// cron, the Retell webhook and the Quo inbound-text webhook.

import type { SupabaseClient } from "@supabase/supabase-js"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"
import { TZ, bookingScriptUrl, speakDateTime, speakSlot, sayWhen, sayWhenIso, phoneDigits, type RetellCall } from "@/lib/retell"
import { sendQuoSms } from "@/lib/quo-client"
import { setEventConfirmed, moveCalendarEvent, deleteCalendarEvent } from "@/lib/google-calendar"

export type Brand = "omdan" | "desert_green"
export type Lang = "en" | "es"

export const BRANDS: Record<Brand, { name: string; phone: string | null }> = {
  omdan:        { name: "Omdan Development",     phone: "(951) 292-0703" },
  desert_green: { name: "Desert Green Builders", phone: null },
}

export interface ScheduledLead {
  id:                string
  full_name:         string
  phone:             string | null
  address:           string | null
  city:              string | null
  scheduled_at:      string | null
  calendar_event_id: string | null
  calendar_id:       string | null
  notes:             string | null
  list:              string
  created_at:        string
}

export interface ConfirmationRow {
  id:                string
  meta_lead_id:      string
  scheduled_at:      string
  brand:             Brand
  status:            "pending" | "confirmed" | "rescheduled" | "cancelled"
  first_call_at:     string | null
  first_call_id:     string | null
  first_call_result: string | null
  text_sent_at:      string | null
  final_call_at:     string | null
  final_call_id:     string | null
  final_call_result: string | null
  confirmed_at:      string | null
}

export const LEAD_COLUMNS = "id, full_name, phone, address, city, scheduled_at, calendar_event_id, calendar_id, notes, list, created_at"

/** Omdan bookings say so in their notes ("Omdan Development: …" from the website,
 *  or the phone receptionist); everything else on the calendar is Desert Green. */
export function leadBrand(lead: Pick<ScheduledLead, "notes">): Brand {
  return /Omdan Development|Phone call \(AI receptionist\)/i.test(lead.notes ?? "") ? "omdan" : "desert_green"
}

export function leadLanguage(lead: Pick<ScheduledLead, "notes">): Lang {
  return /Language:\s*Spanish/i.test(lead.notes ?? "") ? "es" : "en"
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || fullName
}

export function zipOf(address: string | null | undefined): string {
  return String(address ?? "").match(/\b(9[0-6]\d{3})(?:-\d{4})?\b/)?.[1] ?? ""
}

/** Pacific-time date ("yyyy-MM-dd"), time ("HH:mm") and hour of an ISO instant. */
export function ptParts(iso: string) {
  const d = new Date(iso)
  return { date: formatInTimeZone(d, TZ, "yyyy-MM-dd"), time: formatInTimeZone(d, TZ, "HH:mm"), hour: Number(formatInTimeZone(d, TZ, "H")) }
}

export function ptInstant(date: string, time: string): Date {
  return fromZonedTime(`${date}T${time}:00`, TZ)
}

async function addLeadNote(service: SupabaseClient, lead: ScheduledLead, line: string, extra: Record<string, unknown> = {}) {
  const stamp = new Date().toLocaleString("en-US", { timeZone: TZ })
  await service.from("meta_leads")
    .update({ ...extra, notes: [lead.notes, `${line} (${stamp})`].filter(Boolean).join("\n") })
    .eq("id", lead.id)
}

export async function notifyOwner(text: string) {
  if (!process.env.OWNER_CELL) return
  const sms = await sendQuoSms(process.env.OWNER_CELL, text)
  if (!sms.ok) console.error("[appointments] owner text failed:", sms.error)
}

/** The tracking row for this appointment time, created on first use. */
export async function getConfirmation(service: SupabaseClient, lead: ScheduledLead): Promise<ConfirmationRow | null> {
  if (!lead.scheduled_at) return null
  const scheduled_at = new Date(lead.scheduled_at).toISOString()
  const { data: existing } = await service.from("appointment_confirmations")
    .select("*").eq("meta_lead_id", lead.id).eq("scheduled_at", scheduled_at).maybeSingle()
  if (existing) return existing as ConfirmationRow
  const { data, error } = await service.from("appointment_confirmations")
    .upsert({ meta_lead_id: lead.id, scheduled_at, brand: leadBrand(lead) }, { onConflict: "meta_lead_id,scheduled_at" })
    .select("*").single()
  if (error) console.error("[appointments] confirmation row failed:", error.message)
  return (data as ConfirmationRow) ?? null
}

/** Finds the caller's upcoming appointment, by its ref and checked against their number. */
export async function findCallerAppointment(service: SupabaseClient, ref: string | undefined, phone: string | undefined) {
  if (!ref) return { error: "Call lookup_caller first to find their appointment." as const }
  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", ref).maybeSingle()
  const lead = data as ScheduledLead | null
  if (!lead || lead.list !== "scheduled" || !lead.scheduled_at) return { error: "That appointment isn't on the schedule anymore. Offer to book a new one." as const }
  if (phone && phoneDigits(lead.phone) !== phoneDigits(phone)) {
    return { error: "That appointment isn't under this caller's number. Don't share details; offer a callback from David." as const }
  }
  return { lead }
}

export async function markConfirmed(service: SupabaseClient, lead: ScheduledLead, via: string) {
  const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
  if (lead.calendar_event_id && calendarId) {
    try { await setEventConfirmed(calendarId, lead.calendar_event_id, true) }
    catch (err) { console.error("[appointments] calendar confirm failed:", err) }
  }
  const row = await getConfirmation(service, lead)
  if (row && row.status === "pending") {
    await service.from("appointment_confirmations")
      .update({ status: "confirmed", confirmed_at: new Date().toISOString(), confirmed_via: via }).eq("id", row.id)
  }
  await addLeadNote(service, lead, `Appointment confirmed (${via})`)
}

/** Updates the booking backend's Leads sheet (website / phone bookings live there;
 *  appointments booked another way simply aren't found, which is fine). */
async function updateBookingSheet(body: { phone: string; date: string; time: string; newDate?: string; newTime?: string; cancel?: boolean }) {
  const base = bookingScriptUrl()
  const secret = process.env.BOOKING_PHONE_SECRET
  if (!base || !secret) return { ok: false, found: false }
  try {
    const res = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ action: "updateLead", phoneAgentSecret: secret, ...body }),
    })
    return await res.json() as { ok: boolean; found?: boolean }
  } catch (err) {
    console.error("[appointments] booking sheet update failed:", err)
    return { ok: false, found: false }
  }
}

/** Open times for this company at this ZIP, from the booking backend. */
export async function openSlots(brand: Brand, zip: string) {
  const base = bookingScriptUrl()
  if (!base) return null
  const res = await fetch(`${base}?action=availability&brand=${brand === "omdan" ? "omdan" : ""}&zip=${zip}`, { cache: "no-store" })
  return await res.json() as { ok?: boolean; inArea?: boolean; days?: { date: string; slots: { time: string }[] }[] }
}

export async function rescheduleLead(service: SupabaseClient, lead: ScheduledLead, newDate: string, newTime: string, lang: Lang) {
  const brand = leadBrand(lead)
  const zip = zipOf(lead.address)
  const avail = await openSlots(brand, zip).catch(() => null)
  const free = avail?.days?.find((d) => d.date === newDate)?.slots.some((s) => s.time === newTime)
  if (!free) return { ok: false as const, message: "That time isn't open anymore. Check availability again and offer the next two times." }

  const old = ptParts(lead.scheduled_at!)
  const newStart = ptInstant(newDate, newTime)
  const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
  if (lead.calendar_event_id && calendarId) {
    try { await moveCalendarEvent(calendarId, lead.calendar_event_id, newStart.toISOString()) }
    catch (err) {
      console.error("[appointments] calendar move failed:", err)
      return { ok: false as const, message: "Couldn't move it on the calendar. Tell them David will text to confirm the new time." }
    }
  }
  if (lead.phone) await updateBookingSheet({ phone: lead.phone, date: old.date, time: old.time, newDate, newTime })

  const row = await getConfirmation(service, lead)
  if (row) await service.from("appointment_confirmations").update({ status: "rescheduled" }).eq("id", row.id)
  // They just picked the new time on the phone: count it as confirmed.
  await service.from("appointment_confirmations").upsert({
    meta_lead_id: lead.id, scheduled_at: newStart.toISOString(), brand, status: "confirmed",
    confirmed_at: new Date().toISOString(), confirmed_via: "rescheduled by phone",
  }, { onConflict: "meta_lead_id,scheduled_at" })
  await addLeadNote(service, lead, `Rescheduled by phone from ${speakDateTime(lead.scheduled_at!)} to ${speakSlot(newDate, newTime)}`,
    { scheduled_at: newStart.toISOString() })

  const when = speakSlot(newDate, newTime, lang)
  const company = BRANDS[brand]
  if (lead.phone) {
    await sendQuoSms(lead.phone, lang === "es"
      ? `${company.name}: Listo, ${firstName(lead.full_name)}. Su estimado gratis quedó para el ${when}${lead.address ? ` en ${lead.address}` : ""}. ¡Gracias!`
      : `${company.name}: All set, ${firstName(lead.full_name)}! Your free estimate is now ${when}${lead.address ? ` at ${lead.address}` : ""}. Thank you!`)
  }
  await notifyOwner(`Sofia RESCHEDULED (${company.name}): ${lead.full_name} ${lead.phone ?? ""}\nFrom ${speakDateTime(lead.scheduled_at!)} to ${speakSlot(newDate, newTime)}`)
  return { ok: true as const, message: `Moved to ${sayWhen(newDate, newTime, lang)}. A text with the new time was sent.` }
}

export async function cancelLead(service: SupabaseClient, lead: ScheduledLead, reason: string) {
  const old = ptParts(lead.scheduled_at!)
  const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
  if (lead.calendar_event_id && calendarId) {
    try { await deleteCalendarEvent(calendarId, lead.calendar_event_id) }
    catch (err) { console.error("[appointments] calendar delete failed:", err) }
  }
  if (lead.phone) await updateBookingSheet({ phone: lead.phone, date: old.date, time: old.time, cancel: true })
  const row = await getConfirmation(service, lead)
  if (row) await service.from("appointment_confirmations").update({ status: "cancelled", notes: reason || null }).eq("id", row.id)
  // Back on the call list so someone can follow up later.
  await addLeadNote(service, lead, `Appointment ${speakDateTime(lead.scheduled_at!)} CANCELLED by phone${reason ? `: ${reason}` : ""}`,
    { list: "call_list", last_outcome: "callback_later", scheduled_at: null, calendar_event_id: null, calendar_id: null })
  await notifyOwner(`Sofia CANCELLED (${BRANDS[leadBrand(lead)].name}): ${lead.full_name} ${lead.phone ?? ""}\n${speakDateTime(lead.scheduled_at!)}${reason ? `\nReason: ${reason}` : ""}\nMoved back to the call list.`)
}

export function confirmationText(lead: ScheduledLead): string {
  const brand = BRANDS[leadBrand(lead)]
  const lang = leadLanguage(lead)
  const when = speakDateTime(lead.scheduled_at!, lang)
  const today = ptParts(new Date().toISOString()).date === ptParts(lead.scheduled_at!).date
  return lang === "es"
    ? `${brand.name}: Hola ${firstName(lead.full_name)}, le llamamos para confirmar su estimado gratis ${today ? "de hoy" : "de mañana"}, ${when}${lead.address ? ` en ${lead.address}` : ""}. Responda SI para confirmar o 2 si necesita cambiar la hora.`
    : `${brand.name}: Hi ${firstName(lead.full_name)}, we called to confirm your free estimate ${today ? "today" : "tomorrow"}, ${when}${lead.address ? ` at ${lead.address}` : ""}. Please reply YES to confirm, or 2 if you need a different time.`
}

export type CallKind = "first" | "final" | "reschedule_request"

/** Places an outbound confirmation call with the confirmation agent. */
export async function startConfirmationCall(lead: ScheduledLead, row: ConfirmationRow, kind: CallKind) {
  const key = process.env.RETELL_API_KEY
  const from = process.env.RETELL_FROM_NUMBER
  const agent = process.env.RETELL_CONFIRM_AGENT_ID
  if (!key || !from || !agent || !lead.phone) return { ok: false as const, error: "Retell outbound not configured" }
  const brand = leadBrand(lead)
  const lang = leadLanguage(lead)
  const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from_number:      from,
      to_number:        lead.phone.replace(/[^\d+]/g, "").replace(/^(\d{10})$/, "+1$1").replace(/^1(\d{10})$/, "+1$1"),
      override_agent_id: agent,
      metadata:         { kind: "confirmation", stage: kind, confirmation_id: row.id, meta_lead_id: lead.id },
      idempotency_key:  `${row.id}-${kind}`,
      retell_llm_dynamic_variables: {
        company_name:        BRANDS[brand].name,
        brand,
        customer_first_name: firstName(lead.full_name),
        customer_full_name:  lead.full_name,
        appointment_when:    sayWhenIso(lead.scheduled_at!, lang),
        appointment_day:     ptParts(new Date().toISOString()).date === ptParts(lead.scheduled_at!).date ? (lang === "es" ? "hoy" : "today") : (lang === "es" ? "mañana" : "tomorrow"),
        appointment_address: lead.address ?? "",
        appointment_ref:     lead.id,
        zip:                 zipOf(lead.address),
        call_kind:           kind,
        language:            lang,
      },
    }),
  })
  const data = await res.json().catch(() => ({})) as { call_id?: string; message?: string }
  if (!res.ok || !data.call_id) {
    console.error("[appointments] create call failed:", res.status, JSON.stringify(data).slice(0, 300))
    return { ok: false as const, error: data.message ?? `Retell ${res.status}` }
  }
  return { ok: true as const, call_id: data.call_id }
}

const NOT_REACHED = new Set(["dial_no_answer", "dial_busy", "dial_failed", "voicemail_reached", "machine_detected", "invalid_destination", "telephony_provider_permission_denied", "telephony_provider_unavailable", "sip_routing_error", "marked_as_spam", "user_declined", "no_valid_payment", "error_unknown"])

/** After a confirmation call ends (webhook, or the cron catching up):
 *  first call not confirmed -> confirmation text; last call not confirmed -> heads-up to David. */
export async function processConfirmationCall(service: SupabaseClient, call: RetellCall) {
  const meta = (call.metadata ?? {}) as { confirmation_id?: string; stage?: CallKind }
  if (!meta.confirmation_id) return
  const { data: rowData } = await service.from("appointment_confirmations").select("*").eq("id", meta.confirmation_id).maybeSingle()
  const row = rowData as ConfirmationRow | null
  if (!row) return
  const resultField = meta.stage === "final" ? "final_call_result" : "first_call_result"
  if (meta.stage !== "reschedule_request" && row[resultField]) return   // already handled

  const reached = !NOT_REACHED.has(call.disconnection_reason ?? "") && !call.call_analysis?.in_voicemail
    && (call.call_analysis?.custom_analysis_data as { reached_customer?: boolean } | undefined)?.reached_customer !== false
  const result = row.status !== "pending" ? row.status : reached ? "reached_no_decision" : (call.disconnection_reason || "no_answer")
  if (meta.stage !== "reschedule_request") {
    await service.from("appointment_confirmations").update({ [resultField]: result }).eq("id", row.id)
  }
  if (row.status !== "pending") return

  const { data: leadData } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", row.meta_lead_id).maybeSingle()
  const lead = leadData as ScheduledLead | null
  if (!lead?.phone || lead.list !== "scheduled" || !lead.scheduled_at) return

  if (meta.stage === "first" && !row.text_sent_at) {
    const sms = await sendQuoSms(lead.phone, confirmationText(lead))
    await service.from("appointment_confirmations")
      .update(sms.ok ? { text_sent_at: new Date().toISOString() } : { notes: `Confirmation text failed: ${sms.error}`.slice(0, 500) }).eq("id", row.id)
    if (!sms.ok) await notifyOwner(`Couldn't text ${lead.full_name} (${lead.phone}) the confirmation request: ${sms.error.slice(0, 160)}`)
  } else if (meta.stage === "final") {
    await notifyOwner(`Heads-up: ${lead.full_name} (${BRANDS[leadBrand(lead)].name}) has NOT confirmed their ${speakDateTime(lead.scheduled_at)} estimate, and didn't confirm on the last call. ${lead.phone}`)
  }
}
