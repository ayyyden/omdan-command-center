// Professional text normalization helpers for Lia-created customer-facing content.
// Mirror of the normalizePaymentLabel function in lia-bridge/src/lead-parser.ts —
// kept in sync so DB storage and email/PDF output match the Telegram preview.

export function normalizePaymentLabel(raw: string): string {
  const lower = raw.toLowerCase().trim()
  if (!lower) return "Payment"

  // Deposit
  if (/\bdeposit\b/.test(lower)) return "Deposit"

  // Material arrival / delivery
  if (/\bmaterials?\b/.test(lower)) {
    return /\b(?:arrive[sd]?|arrival|deliver(?:y|ies|ed)?|order(?:ed)?)\b/.test(lower)
      ? "Upon Material Arrival"
      : "Upon Material Delivery"
  }

  // Project start / mobilization
  if (/\b(?:start|begin[s]?|mobiliz(?:ation)?|kick[\s-]?off)\b/.test(lower)) {
    return "Upon Project Start"
  }

  // "final" alone → "Final Payment" (no "upon completion" needed for plain label)
  if (/^final\s*(?:payment)?$/.test(lower)) return "Final Payment"

  // Completion / done / rest / remainder / final (in context)
  if (/\b(?:done|finish(?:ed)?|complet(?:e[sd]?|ion)|end(?:\s+of)?|rest|remainder|remaining|balance|final)\b/.test(lower)) {
    return "Final Payment Upon Completion"
  }

  // Progress / mid-point
  if (/\b(?:progress|mid(?:way)?|halfway|partial)\b/.test(lower)) return "Progress Payment"

  // Fallback: title-case the raw label
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}
