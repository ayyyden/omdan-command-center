import { requirePermission } from "@/lib/auth-helpers"

const TWILIO_ACCOUNT_SID    = process.env.TWILIO_ACCOUNT_SID
const TWILIO_API_KEY        = process.env.TWILIO_API_KEY
const TWILIO_API_SECRET     = process.env.TWILIO_API_SECRET
const TWILIO_TWIML_APP_SID  = process.env.TWILIO_TWIML_APP_SID

export async function GET() {
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session

  const missing: string[] = []
  if (!TWILIO_ACCOUNT_SID)   missing.push("TWILIO_ACCOUNT_SID")
  if (!TWILIO_API_KEY)       missing.push("TWILIO_API_KEY")
  if (!TWILIO_API_SECRET)    missing.push("TWILIO_API_SECRET")
  if (!TWILIO_TWIML_APP_SID) missing.push("TWILIO_TWIML_APP_SID")
  if (missing.length) {
    return Response.json(
      { error: `Missing Twilio Voice env vars: ${missing.join(", ")}` },
      { status: 503 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const twilio = require("twilio")
  const AccessToken = twilio.jwt.AccessToken
  const VoiceGrant  = AccessToken.VoiceGrant

  const grant = new VoiceGrant({
    outgoingApplicationSid: TWILIO_TWIML_APP_SID,
    incomingAllow: false,
  })

  const token = new AccessToken(TWILIO_ACCOUNT_SID, TWILIO_API_KEY, TWILIO_API_SECRET, {
    identity: session.userId,
    ttl: 3600,
  })
  token.addGrant(grant)

  return Response.json({ token: token.toJwt() })
}
