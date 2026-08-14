import { NextRequest } from "next/server"
import { TWILIO_FROM_PHONE, verifyTwilioSignature } from "@/lib/twilio-client"

// Public webhook called by Twilio when a browser Voice SDK call is initiated.
// Twilio POSTs the params from device.connect({ params: { To, ... } }) as form data.

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`
  return null
}

export async function POST(req: NextRequest) {
  const xmlHeader = { "Content-Type": "text/xml" }

  let rawTo: string | null = null
  let formParams: Record<string, string> = {}

  try {
    const form = await req.formData()
    for (const [key, value] of form.entries()) formParams[key] = String(value)
    rawTo = (form.get("To") ?? form.get("to") ?? form.get("phone")) as string | null
  } catch {
    // Fall through to query params — a GET request has no body to parse.
  }

  // For GET, Twilio signs against the URL alone (query params included in
  // it) with an empty params object — only POST carries signed body params.
  if (!verifyTwilioSignature(req, req.method === "POST" ? formParams : {})) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Reject/></Response>`,
      { status: 403, headers: xmlHeader }
    )
  }

  if (!rawTo) {
    const { searchParams } = new URL(req.url)
    rawTo = searchParams.get("To") ?? searchParams.get("to") ?? searchParams.get("phone")
  }

  console.log("[twiml/browser] raw destination:", rawTo ?? "(none)")

  if (!rawTo) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Configuration error: missing destination phone number.</Say><Hangup/></Response>`,
      { headers: xmlHeader }
    )
  }

  const e164 = toE164(rawTo)
  console.log("[twiml/browser] normalized destination:", e164 ?? "(invalid)")

  if (!e164) {
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Configuration error: invalid destination phone number.</Say><Hangup/></Response>`,
      { headers: xmlHeader }
    )
  }

  const twiml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial callerId="${TWILIO_FROM_PHONE}" timeout="30">`,
    `    <Number>${e164}</Number>`,
    `  </Dial>`,
    `</Response>`,
  ].join("\n")

  return new Response(twiml, { headers: xmlHeader })
}

// Also handle GET in case the TwiML App is configured with GET method
export async function GET(req: NextRequest) {
  return POST(req)
}
