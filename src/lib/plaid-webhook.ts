// Verifies Plaid webhook requests are genuinely from Plaid.
// Scheme: https://plaid.com/docs/api/webhooks/webhook-verification/
// The `Plaid-Verification` header is a JWT (ES256). We fetch the public key
// for its `kid` from Plaid, verify the signature, check it's fresh (<5 min),
// then confirm the JWT's embedded SHA-256 hash matches the RAW request body
// — must be the literal bytes Plaid sent, never a re-serialized JSON.stringify,
// or the hash comparison will spuriously fail.

import { importJWK, jwtVerify, type JWK } from "jose"
import { createHash, timingSafeEqual } from "crypto"
import { getPlaidClient } from "@/lib/plaid"

// Verification keys don't rotate often — Plaid recommends caching them.
// Module-level Map persists across warm invocations on Vercel.
const keyCache = new Map<string, JWK>()

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!verificationHeader) return { ok: false, error: "Missing Plaid-Verification header" }

  const parts = verificationHeader.split(".")
  if (parts.length !== 3) return { ok: false, error: "Malformed JWT" }

  let header: { kid?: string; alg?: string }
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))
  } catch {
    return { ok: false, error: "Malformed JWT header" }
  }
  if (header.alg !== "ES256") return { ok: false, error: `Unexpected JWT alg: ${header.alg}` }
  if (!header.kid) return { ok: false, error: "JWT header missing kid" }

  let jwk = keyCache.get(header.kid)
  if (!jwk) {
    try {
      const plaid = getPlaidClient()
      const { data } = await plaid.webhookVerificationKeyGet({ key_id: header.kid })
      jwk = data.key as unknown as JWK
      keyCache.set(header.kid, jwk)
    } catch (err) {
      return { ok: false, error: `Failed to fetch verification key: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  let payload: { iat?: number; request_body_sha256?: string }
  try {
    const key = await importJWK(jwk, "ES256")
    const result = await jwtVerify(verificationHeader, key)
    payload = result.payload as typeof payload
  } catch (err) {
    return { ok: false, error: `JWT verification failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  if (!payload.iat || Date.now() / 1000 - payload.iat > 5 * 60) {
    return { ok: false, error: "Webhook is stale (issued more than 5 minutes ago)" }
  }
  if (!payload.request_body_sha256) {
    return { ok: false, error: "JWT missing request_body_sha256" }
  }

  const computed = createHash("sha256").update(rawBody).digest()
  const expected = Buffer.from(payload.request_body_sha256, "hex")
  if (computed.length !== expected.length || !timingSafeEqual(computed, expected)) {
    return { ok: false, error: "Request body hash mismatch" }
  }

  return { ok: true }
}
