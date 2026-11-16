// An estimate already booked is given to another salesman: the customer gets
// one text saying who's coming (unless the "text the customer" box was unticked).

import type { SupabaseClient } from "@supabase/supabase-js"
import { leadBrand, leadLanguage } from "@/lib/appointments"
import { salesmanChangedText, sendBookingConfirmation } from "@/lib/booking-texts"
import { speakSlotWindow } from "@/lib/retell"
import { isRealUsPhone, toE164 } from "@/lib/quo-client"
import { pmFirstName } from "@/lib/pm-calendars"

type Customer = { name: string | null; phone: string | null }

/** For a CRM appointment (lead_appointments row). Returns what happened. */
export async function textSalesmanChange(service: SupabaseClient, appointmentId: string): Promise<string> {
  const { data: a } = await service.from("lead_appointments")
    .select("scheduled_date, start_time, status, notes, assigned_pm:project_managers(name), customer:customers(name, phone)")
    .eq("id", appointmentId).maybeSingle()
  if (!a || a.status === "cancelled" || !a.scheduled_date || !a.start_time) return "skipped (no upcoming time)"
  const customer = (Array.isArray(a.customer) ? a.customer[0] : a.customer) as Customer | null
  const pm = (Array.isArray(a.assigned_pm) ? a.assigned_pm[0] : a.assigned_pm) as { name: string } | null
  return sendSalesmanChange({
    phone: customer?.phone ?? null, fullName: customer?.name ?? "", notes: a.notes as string | null,
    date: a.scheduled_date as string, time: String(a.start_time).slice(0, 5), pmName: pm?.name ?? null,
  })
}

export async function sendSalesmanChange(o: { phone: string | null; fullName: string; notes: string | null; date: string; time: string; pmName: string | null }): Promise<string> {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  if (o.date < today) return "skipped (already passed)"
  const phone = toE164(o.phone ?? "")
  if (!phone || !isRealUsPhone(phone)) return "skipped (no real phone number)"
  const lead = { notes: o.notes }
  const lang = leadLanguage(lead)
  const text = salesmanChangedText({
    brand: leadBrand(lead), fullName: o.fullName, lang,
    when: speakSlotWindow(o.date, o.time, lang), who: pmFirstName(o.pmName),
  })
  const r = await sendBookingConfirmation(phone, leadBrand(lead), text)
  return r.ok ? "sent" : `failed: ${r.error}`
}
