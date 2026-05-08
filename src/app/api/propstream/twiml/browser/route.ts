import { NextRequest } from "next/server"
import { TWILIO_FROM_PHONE } from "@/lib/twilio-client"

// Public webhook called by Twilio when a browser Voice SDK call is initiated.
// Twilio sends the <To> parameter from device.connect({ params: { To } }).
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const to   = form.get("To") as string | null

  if (!to) {
    return new Response(
      `<Response><Say>Missing destination number.</Say></Response>`,
      { headers: { "Content-Type": "text/xml" } }
    )
  }

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${TWILIO_FROM_PHONE}" timeout="30">
    <Number>${to}</Number>
  </Dial>
</Response>`

  return new Response(twiml, { headers: { "Content-Type": "text/xml" } })
}
