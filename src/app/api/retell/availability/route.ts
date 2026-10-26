import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, bookingScriptUrl, sayWhen } from "@/lib/retell"

// POST /api/retell/availability — Retell tool "check_availability".
// Asks the website booking backend (same rules as the website: open days,
// max per day, notice, blocked times, Google Calendar, drive time from the
// caller's ZIP) and returns a few open times the agent can offer out loud.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args } = await readToolCall<{
    zip?:            string
    preferred_date?: string   // YYYY-MM-DD
    part_of_day?:    "morning" | "afternoon" | "evening" | "any"
    language?:       "en" | "es"
    brand?:          "omdan" | "desert_green"
  }>(req)
  const lang = args.language === "es" ? "es" : "en"
  const zip = String(args.zip ?? "").replace(/\D/g, "").slice(0, 5)
  if (zip.length !== 5) return toolReply({ ok: false, message: "Ask the caller for their 5-digit ZIP code first." })

  const base = bookingScriptUrl()
  if (!base) return toolReply({ ok: false, message: "The calendar is unavailable right now. Take their details and tell them David will call to confirm a time." })

  let data: { ok?: boolean; inArea?: boolean; days?: { date: string; slots: { time: string }[] }[] }
  try {
    const res = await fetch(`${base}?action=availability&brand=${args.brand === "desert_green" ? "" : "omdan"}&zip=${zip}`, { cache: "no-store" })
    data = await res.json()
  } catch (err) {
    console.error("[retell/availability] backend failed:", err)
    return toolReply({ ok: false, message: "The calendar is unavailable right now. Take their details and tell them David will call to confirm a time." })
  }

  if (data.inArea === false) {
    return toolReply({ ok: false, out_of_area: true, message: "This ZIP is outside our service area. Politely say we don't currently serve that area, and offer to have David call them back in case he can make an exception." })
  }

  const inPart = (hm: string) => {
    const h = parseInt(hm, 10)
    switch (args.part_of_day) {
      case "morning":   return h < 12
      case "afternoon": return h >= 12 && h < 16
      case "evening":   return h >= 16
      default:          return true
    }
  }

  let days = (data.days ?? []).map((d) => ({ date: d.date, times: d.slots.map((s) => s.time).filter(inPart) }))
    .filter((d) => d.times.length)
  if (!days.length) {
    return toolReply({ ok: true, slots: [], message: "No open times match that. Offer a different part of the day or another day." })
  }

  let picked: { date: string; time: string }[]
  const preferred = args.preferred_date && days.find((d) => d.date === args.preferred_date)
  if (preferred) {
    picked = preferred.times.slice(0, 4).map((time) => ({ date: preferred.date, time }))
  } else {
    // Soonest first: two times on each of the next two open days.
    days = days.slice(0, 2)
    picked = days.flatMap((d) => [d.times[0], d.times[Math.floor(d.times.length / 2)]]
      .filter((t, i, a) => t && a.indexOf(t) === i)
      .map((time) => ({ date: d.date, time })))
  }

  return toolReply({
    ok: true,
    note: args.preferred_date && !preferred ? "That day is full or closed; these are the closest open times." : undefined,
    slots: picked.map((s) => ({ date: s.date, time: s.time, say: sayWhen(s.date, s.time, lang) })),
    message: "Offer two of these times, not the whole list. Book with the exact date and time values.",
  })
}
