import { NextRequest } from "next/server"
import { TWILIO_FROM_PHONE } from "@/lib/twilio-client"

// Public route — called by Twilio when the VA answers the bridge call.
// Returns TwiML that connects the VA to the lead's phone number.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const to = searchParams.get("to")

  if (!to) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say>Configuration error. Missing destination.</Say><Hangup/></Response>`
    return new Response(xml, { headers: { "Content-Type": "text/xml" } })
  }

  const xml = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<Response>`,
    `  <Say>Connecting now.</Say>`,
    `  <Dial callerId="${TWILIO_FROM_PHONE}" timeout="30">`,
    `    <Number>${to}</Number>`,
    `  </Dial>`,
    `</Response>`,
  ].join("\n")

  return new Response(xml, { headers: { "Content-Type": "text/xml" } })
}

// Twilio may POST to this URL as well when using it as a statusCallback
export async function POST(req: NextRequest) {
  return GET(req)
}
