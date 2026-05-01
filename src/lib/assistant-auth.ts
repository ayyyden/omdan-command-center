import { NextResponse } from "next/server"

/**
 * Verifies the x-assistant-secret header matches ASSISTANT_SECRET env var.
 * Returns a 401 NextResponse if invalid, or null if authorized.
 * Used by all /api/assistant/* routes to authenticate Lia bridge requests.
 */
export function verifyAssistantSecret(req: Request): NextResponse | null {
  const secret = req.headers.get("x-assistant-secret")
  if (!secret || secret !== process.env.ASSISTANT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return null
}
