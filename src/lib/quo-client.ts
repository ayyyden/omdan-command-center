// Quo (formerly OpenPhone) — sends the automatic "No Answer" follow-up text
// for Meta Lead Jobs. REST API, API-key auth (raw key in the Authorization
// header, no "Bearer " prefix). Docs: https://www.quo.com/docs/api-reference

export function assertQuoConfig(): { ok: true } | { ok: false; error: string } {
  if (!process.env.QUO_API_KEY)    return { ok: false, error: "Quo is not configured — set QUO_API_KEY" }
  if (!process.env.QUO_FROM_NUMBER) return { ok: false, error: "Quo is not configured — set QUO_FROM_NUMBER" }
  return { ok: true }
}

// Best-effort normalization to E.164 — Quo rejects anything else. Leads
// mostly already arrive as "+1XXXXXXXXXX" (from the desertleads bot format),
// but manual entries may just be 10 digits.
export function toE164(phone: string): string | null {
  const digits = phone.replace(/[^\d+]/g, "")
  if (digits.startsWith("+")) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return null
}

export async function sendQuoSms(toPhone: string, content: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const check = assertQuoConfig()
  if (!check.ok) return check

  const to = toE164(toPhone)
  if (!to) return { ok: false, error: `Could not format "${toPhone}" as a valid phone number` }

  try {
    const res = await fetch("https://api.quo.com/v1/messages", {
      method:  "POST",
      headers: {
        "Authorization": process.env.QUO_API_KEY!,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        content,
        from: process.env.QUO_FROM_NUMBER,
        to:   [to],
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      return { ok: false, error: `Quo API error (${res.status}): ${text.slice(0, 300)}` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
