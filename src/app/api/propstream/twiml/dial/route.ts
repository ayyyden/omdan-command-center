import { NextRequest } from "next/server"
import { TWILIO_FROM_PHONE } from "@/lib/twilio-client"

// Public route — called by Twilio when a call needs to be connected.
// Supports both bridge calls (GET/POST with query param) and browser SDK
// calls (POST with form-encoded body containing To/to/phone).

function toE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`
  return null
}

function buildTwiml(to: string): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Dial callerId="${TWILIO_FROM_PHONE}" timeout="30">`,
    `    <Number>${to}</Number>`,
    `  </Dial>`,
    `</Response>`,
  ].join("\n")
}

function errorTwiml(msg: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${msg}</Say><Hangup/></Response>`
}

async function handle(req: NextRequest): Promise<Response> {
  const xmlHeader = { "Content-Type": "text/xml" }

  // Read destination from POST body first (browser SDK sends form-encoded body)
  let rawTo: string | null = null

  if (req.method === "POST") {
    try {
      const form = await req.formData()
      rawTo = (form.get("To") ?? form.get("to") ?? form.get("phone")) as string | null
    } catch {
      // Body not form-encoded — fall through to query params
    }
  }

  // Fall back to URL query params (bridge call compat: ?to=+1xxx or ?To=+1xxx)
  if (!rawTo) {
    const { searchParams } = new URL(req.url)
    rawTo = searchParams.get("To") ?? searchParams.get("to") ?? searchParams.get("phone")
  }

  console.log("[twiml/dial] raw destination:", rawTo ?? "(none)")

  if (!rawTo) {
    console.error("[twiml/dial] no destination param found in body or query")
    return new Response(
      errorTwiml("Configuration error: missing destination phone number."),
      { headers: xmlHeader }
    )
  }

  const e164 = toE164(rawTo)
  console.log("[twiml/dial] normalized destination:", e164 ?? "(invalid)")

  if (!e164) {
    console.error("[twiml/dial] could not normalize to E.164:", rawTo)
    return new Response(
      errorTwiml("Configuration error: invalid destination phone number."),
      { headers: xmlHeader }
    )
  }

  return new Response(buildTwiml(e164), { headers: xmlHeader })
}

export async function GET(req: NextRequest) {
  return handle(req)
}

export async function POST(req: NextRequest) {
  return handle(req)
}
