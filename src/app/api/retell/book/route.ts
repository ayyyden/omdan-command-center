import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, bookingScriptUrl, speakSlot } from "@/lib/retell"
import { toE164, sendQuoSms } from "@/lib/quo-client"

// Service keys the booking backend knows for brand "omdan" (Code.gs OMDAN.labels).
const SERVICES = ["turf", "pavers", "concrete", "gravel", "full-remodel", "pool", "kitchen", "bathroom", "windows",
  "roofing", "insulation", "hvac", "gutters", "plumbing", "painting", "cool-life-paint"]
const STARTS = ["asap", "1-3", "3plus", "planning"]

// POST /api/retell/book — Retell tool "book_estimate".
// Books the free on-site estimate through the website booking backend
// (source "phone"), which re-checks the slot, writes the Leads sheet + Google
// Calendar, emails the lead and forwards it to the CRM. Then texts the caller
// a confirmation from the business Quo number.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{
    full_name?:       string
    phone?:           string
    street?:          string
    city?:            string
    zip?:             string
    date?:            string
    time?:            string
    services?:        string[]
    start?:           string
    project_summary?: string
    language?:        "en" | "es"
  }>(req)
  const lang = args.language === "es" ? "es" : "en"

  const base = bookingScriptUrl()
  const secret = process.env.BOOKING_PHONE_SECRET
  if (!base || !secret) return toolReply({ ok: false, message: "Booking is unavailable right now. Tell the caller David will call them shortly to lock in the time." })

  const phone = toE164(args.phone || call.from_number || "")
  const services = (args.services ?? []).filter((s) => SERVICES.includes(s))
  const missing = [
    !/\S+\s+\S+/.test(args.full_name ?? "") && "first and last name",
    !phone && "a phone number",
    (args.street ?? "").trim().length < 5 && "street address",
    !(args.city ?? "").trim() && "city",
    !/^\d{5}$/.test(args.zip ?? "") && "ZIP code",
    !(/^\d{4}-\d{2}-\d{2}$/.test(args.date ?? "") && /^\d{2}:\d{2}$/.test(args.time ?? "")) && "a time from check_availability",
    !services.length && "which service it's for",
  ].filter(Boolean)
  if (missing.length) return toolReply({ ok: false, message: `Still need: ${missing.join(", ")}.` })

  let data: { ok?: boolean; error?: string }
  try {
    const res = await fetch(base, {
      method:  "POST",
      headers: { "Content-Type": "text/plain" },   // Apps Script reads postData.contents
      body:    JSON.stringify({
        action: "book", brand: "omdan", source: "phone", phoneAgentSecret: secret,
        fullName: args.full_name!.trim(), phone, street: args.street!.trim(), unit: "", city: args.city!.trim(),
        state: "CA", zip: args.zip, date: args.date, time: args.time, services,
        start: STARTS.includes(args.start ?? "") ? args.start : "planning",
        homeowner: "yes", consent: true, lang, notes: (args.project_summary ?? "").slice(0, 500),
        callId: call.call_id ?? "",
      }),
    })
    data = await res.json()
  } catch (err) {
    console.error("[retell/book] backend failed:", err)
    return toolReply({ ok: false, message: "Booking failed on our side. Apologize, keep their details, and tell them David will call shortly to confirm." })
  }

  if (!data.ok) {
    const msg: Record<string, string> = {
      slot_taken:   "That time was just taken. Call check_availability again and offer the next two times.",
      out_of_area:  "That ZIP is outside our service area. Politely explain and offer a callback from David.",
      invalid:      "Some details were rejected. Re-confirm name, full street address, city and ZIP, then try again.",
      rate_limited: "Too many booking attempts for this number. Tell them David will call to confirm.",
    }
    return toolReply({ ok: false, error: data.error, message: msg[data.error ?? ""] ?? "Booking failed. Tell them David will call shortly to confirm." })
  }

  const when = speakSlot(args.date!, args.time!, lang)
  const site = "https://omdandevelopment.com"
  const text = lang === "es"
    ? `Omdan Development: ¡Listo, ${args.full_name!.split(" ")[0]}! Su estimado gratis en sitio es el ${when} en ${args.street}, ${args.city}. David le avisará cuando vaya en camino. ¿Preguntas? Llame o escriba al (951) 292-0703. ${site}`
    : `Omdan Development: You're all set, ${args.full_name!.split(" ")[0]}! Your free on-site estimate is ${when} at ${args.street}, ${args.city}. David will text when he's on the way. Questions? Call or text (951) 292-0703. ${site}`
  const sms = await sendQuoSms(phone!, text)

  return toolReply({
    ok: true,
    confirmation_text_sent: sms.ok,
    message: `Booked for ${when}. ${sms.ok ? "A confirmation text was sent." : "The confirmation text could not be sent; tell them they'll get a reminder the day before."}`,
  })
}
