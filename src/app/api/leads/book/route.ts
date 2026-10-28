import { NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { syncLeadAppointmentCalendarEvent } from "@/lib/lead-appointment-calendar-sync"
import { BRANDS, type Brand } from "@/lib/appointments"
import { toE164 } from "@/lib/quo-client"
import { phoneDigits, speakSlot } from "@/lib/retell"
import { bookingConfirmationText, sendBookingConfirmation } from "@/lib/booking-texts"

// POST /api/leads/book — the CRM "Add lead" form.
// Creates (or reuses, by phone) the customer, books the estimate as a lead
// appointment with the assigned PM, puts it on Google Calendar (with Phone /
// Company lines, so Sofia confirms it like any other appointment) and texts
// the customer a confirmation from their company's Quo number.
export async function POST(req: Request) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  if (!["owner", "admin"].includes(session.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const b = await req.json().catch(() => ({})) as {
    brand?:       Brand
    full_name?:   string
    phone?:       string
    email?:       string | null
    address?:     string
    homeowner?:   "yes" | "no"
    job_type?:    string
    description?: string | null
    language?:    "en" | "es"
    lead_source?: string | null
    date?:        string    // YYYY-MM-DD
    time?:        string    // HH:MM
    pm_id?:       string | null
    send_text?:   boolean
  }
  const brand: Brand = b.brand === "desert_green" ? "desert_green" : "omdan"
  const lang = b.language === "es" ? "es" : "en"
  const name = (b.full_name ?? "").trim()
  const phone = toE164(b.phone ?? "")
  const address = (b.address ?? "").trim()
  const jobType = (b.job_type ?? "").trim()

  const missing = [
    !name && "name",
    !phone && "a valid phone number",
    address.length < 5 && "address",
    !jobType && "type of job",
    !(/^\d{4}-\d{2}-\d{2}$/.test(b.date ?? "") && /^\d{2}:\d{2}$/.test(b.time ?? "")) && "an appointment time",
  ].filter(Boolean)
  if (missing.length) return NextResponse.json({ error: `Missing: ${missing.join(", ")}` }, { status: 400 })

  const service = createServiceClient()

  // Same person already in the CRM (phones are stored in many formats)?
  const digits = phoneDigits(phone)
  const { data: samePhone } = await service.from("customers").select("id, phone").ilike("phone", `%${digits.slice(-4)}%`)
  let customerId = (samePhone ?? []).find((c) => phoneDigits(c.phone) === digits)?.id as string | undefined
  const details = {
    name, phone, address,
    email:        b.email?.trim() || null,
    service_type: jobType,
    lead_source:  b.lead_source || null,
    status:       "Scheduled",
  }
  if (customerId) {
    await service.from("customers").update({ ...details, lead_source: details.lead_source ?? undefined }).eq("id", customerId)
  } else {
    const { data: created, error } = await service.from("customers")
      .insert({ ...details, user_id: session.userId }).select("id").single()
    if (error || !created) return NextResponse.json({ error: error?.message ?? "Couldn't create the customer" }, { status: 500 })
    customerId = created.id as string
  }

  const [h, m] = b.time!.split(":").map(Number)
  const end = `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`
  const notes = [
    `Company: ${BRANDS[brand].name}`,
    `Homeowner: ${b.homeowner === "no" ? "No" : "Yes"}`,
    lang === "es" ? "Language: Spanish" : null,
    b.description?.trim() || null,
    "Booked in the CRM",
  ].filter(Boolean).join("\n")

  const { data: appt, error: apptErr } = await service.from("lead_appointments").insert({
    customer_id:     customerId,
    user_id:         session.userId,
    scheduled_date:  b.date,
    start_time:      b.time,
    end_time:        end,
    status:          "scheduled",
    source:          "crm",
    project_summary: jobType,
    notes,
    assigned_pm_id:  b.pm_id || null,
  }).select("id").single()
  if (apptErr || !appt) return NextResponse.json({ error: apptErr?.message ?? "Couldn't save the appointment" }, { status: 500 })

  const calendar = await syncLeadAppointmentCalendarEvent(appt.id).catch((err) => ({ ok: false as const, error: String(err) }))

  let text: { ok: boolean; error?: string } = { ok: false, error: "skipped" }
  if (b.send_text !== false) {
    let visitor: string | null = null
    if (b.pm_id) {
      const { data: pm } = await service.from("project_managers").select("name").eq("id", b.pm_id).maybeSingle()
      visitor = (pm?.name as string) ?? null
    }
    const content = bookingConfirmationText({ brand, fullName: name, when: speakSlot(b.date!, b.time!, lang), address, lang, visitor })
    text = await sendBookingConfirmation(phone!, brand, content)
  }

  await service.from("activity_log").insert({
    user_id:     session.userId,
    entity_type: "customer",
    entity_id:   customerId,
    action:      "created",
    description: `Estimate booked in the CRM: ${name}, ${speakSlot(b.date!, b.time!)}`,
  })

  return NextResponse.json({
    ok:            true,
    customer_id:   customerId,
    appointment_id: appt.id,
    calendar:      calendar.ok ? "added" : `failed: ${"error" in calendar ? calendar.error : ""}`,
    text:          text.ok ? "sent" : `not sent: ${text.error}`,
  })
}
