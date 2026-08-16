import { NextRequest } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"

// Public, token-gated — logs the customer's explicit ESIGN/UETA consent
// before they ever see the fill form. Called by the Consent screen when
// they check the box and hit Continue.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select("id, recipient_email, signed_at")
    .eq("signing_token", token)
    .single()

  if (!sent) return Response.json({ error: "Contract not found" }, { status: 404 })
  if (sent.signed_at) return Response.json({ error: "Already signed" }, { status: 409 })

  void logAudit({
    documentType:  "contract",
    documentId:    sent.id,
    tokenHash:     hashToken(token),
    action:        "consented",
    customerEmail: sent.recipient_email ?? null,
    ipAddress:     getIp(req.headers),
    userAgent:     getUa(req.headers),
  })

  return Response.json({ success: true })
}
