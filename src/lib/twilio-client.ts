import twilio from "twilio"

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

export const NO_ANSWER_SMS = (
  "Hi, this is Omdan Development. We tried reaching you regarding your property. " +
  "If you're interested in a free estimate for turf, pavers, concrete, or outdoor upgrades, " +
  "call or text us back at (951) 292-0703. Reply STOP to opt out."
)

export const STOP_KEYWORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit"])
