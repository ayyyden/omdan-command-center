import twilio from "twilio"
import type { NextRequest } from "next/server"

const TWILIO_ACCOUNT_SID  = process.env.TWILIO_ACCOUNT_SID
const TWILIO_AUTH_TOKEN   = process.env.TWILIO_AUTH_TOKEN
export const TWILIO_FROM_PHONE = process.env.TWILIO_FROM_PHONE ?? ""
export const TWILIO_MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID ?? ""

export function getTwilioClient() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error(
      "Twilio is not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your environment variables."
    )
  }
  return twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
}

export function assertTwilioConfig(): { ok: true } | { ok: false; error: string } {
  const missing: string[] = []
  if (!TWILIO_ACCOUNT_SID)  missing.push("TWILIO_ACCOUNT_SID")
  if (!TWILIO_AUTH_TOKEN)   missing.push("TWILIO_AUTH_TOKEN")
  if (!TWILIO_FROM_PHONE)   missing.push("TWILIO_FROM_PHONE")
  if (missing.length) {
    return { ok: false, error: `Missing Twilio env vars: ${missing.join(", ")}` }
  }
  return { ok: true }
}

// Confirms a webhook request genuinely came from Twilio — these routes are
// never called by our own code (only Twilio, per its dashboard/TwiML App
// config), so this can reject anything unsigned without breaking a
// legitimate caller. Uses the app's own public URL rather than req.url,
// since req.url can reflect Vercel's internal proxy address rather than the
// exact address Twilio signed against.
export function verifyTwilioSignature(req: NextRequest, params: Record<string, string>): boolean {
  if (!TWILIO_AUTH_TOKEN) return false
  const signature = req.headers.get("x-twilio-signature")
  if (!signature) return false

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://omdan-command-center.vercel.app").replace(/\/+$/, "")
  const url = `${appUrl}${req.nextUrl.pathname}${req.nextUrl.search}`

  return twilio.validateRequest(TWILIO_AUTH_TOKEN, signature, url, params)
}

export const NO_ANSWER_SMS = (
  "Hi, this is Omdan Development. We tried reaching you regarding your property. " +
  "If you're interested in a free estimate for turf, pavers, concrete, or outdoor upgrades, " +
  "call or text us back at (951) 292-0703. Reply STOP to opt out."
)

export const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"])
