// Retell AI phone receptionist — shared helpers for the /api/retell/* routes.
// The agent (phone-agent/setup.mjs) calls these routes as custom tools during
// a live call, with the shared secret in the x-retell-secret header.
//
// Scheduling lives in the website booking backend (Google Apps Script), so
// phone bookings share one calendar, one daily cap and one Leads sheet with
// the website, and reach the CRM through the same /api/meta-leads/website path.

import { NextResponse } from "next/server"
import { formatInTimeZone, fromZonedTime } from "date-fns-tz"

export const TZ = "America/Los_Angeles"

export function verifyRetellSecret(req: Request): NextResponse | null {
  const expected = process.env.RETELL_TOOL_SECRET
  const secret = req.headers.get("x-retell-secret") ?? new URL(req.url).searchParams.get("secret")
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}

export interface RetellCall {
  call_id?:     string
  from_number?: string
  to_number?:   string
  direction?:   string
  transcript?:  string
  start_timestamp?: number
  end_timestamp?:   number
  recording_url?:   string
  disconnection_reason?: string
  call_analysis?: {
    call_summary?:         string
    user_sentiment?:       string
    call_successful?:      boolean
    custom_analysis_data?: Record<string, unknown>
  }
}

// Custom tool request: { name, call, args } (args_at_root is off).
export async function readToolCall<T>(req: Request): Promise<{ args: T; call: RetellCall }> {
  const body = await req.json().catch(() => ({})) as { args?: T; call?: RetellCall }
  return { args: (body.args ?? {}) as T, call: body.call ?? {} }
}

// The tool response is read back to the LLM, so plain short sentences work best.
export function toolReply(data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status })
}

export function bookingScriptUrl(): string | null {
  return process.env.BOOKING_SCRIPT_URL || null
}

/** Last 10 digits, for matching phones stored in any format. */
export function phoneDigits(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10)
}

/** "2026-10-28" + "14:00" -> "Wednesday, October 28 at 2:00 PM" (Spanish when lang = es). */
export function speakSlot(date: string, time: string, lang: "en" | "es" = "en"): string {
  const when = fromZonedTime(`${date}T${time}:00`, TZ)
  if (lang === "es") {
    const day = new Intl.DateTimeFormat("es-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(when)
    const hour = new Intl.DateTimeFormat("es-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" }).format(when)
    return `${day} a las ${hour}`
  }
  return `${formatInTimeZone(when, TZ, "EEEE, MMMM d")} at ${formatInTimeZone(when, TZ, "h:mm a")}`
}

export function speakDateTime(iso: string, lang: "en" | "es" = "en"): string {
  const d = new Date(iso)
  return speakSlot(formatInTimeZone(d, TZ, "yyyy-MM-dd"), formatInTimeZone(d, TZ, "HH:mm"), lang)
}
