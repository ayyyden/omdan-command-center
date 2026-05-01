// OpenClaw WhatsApp client
//
// Adapt endpoint paths and request shape to match your OpenClaw version.
// Configure OpenClaw to POST incoming message webhooks to:
//   https://lia.omdandevelopment.com/webhook/message
//
// Common OpenClaw send endpoint: POST /api/messages/send  (or /api/send)
// Refer to your OpenClaw docs at OPENCLAW_BASE_URL after installation.

const OPENCLAW_BASE_URL = process.env.OPENCLAW_BASE_URL!
const OPENCLAW_TOKEN    = process.env.OPENCLAW_TOKEN!

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${OPENCLAW_TOKEN}`,
  }
}

// Normalize number: strip non-digits, ensure no @s.whatsapp.net suffix
function normalizeNumber(raw: string): string {
  return raw.replace(/@.*$/, "").replace(/[^0-9]/g, "")
}

export async function sendWhatsAppText(to: string, text: string): Promise<void> {
  const number = normalizeNumber(to)
  const res = await fetch(`${OPENCLAW_BASE_URL}/api/messages/send`, {
    method: "POST",
    headers: authHeaders(),
    // Adjust this body shape to match your OpenClaw version
    body: JSON.stringify({
      to: number,
      type: "text",
      text: { body: text },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OpenClaw send failed (${res.status}): ${body}`)
  }
}

// Send interactive button message if OpenClaw supports it.
// Falls back to plain text with typed-reply instructions if not supported.
export async function sendWhatsAppButtons(
  to: string,
  text: string,
  buttons: Array<{ id: string; title: string }>
): Promise<void> {
  const number = normalizeNumber(to)
  try {
    const res = await fetch(`${OPENCLAW_BASE_URL}/api/messages/send`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        to: number,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text },
          action: {
            buttons: buttons.map(b => ({
              type: "reply",
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
  } catch {
    // Fallback: plain text with typed reply instructions
    const instructions = buttons.map(b => `• Reply "${b.id.toUpperCase()}" to ${b.title}`).join("\n")
    await sendWhatsAppText(to, `${text}\n\n${instructions}`)
  }
}
