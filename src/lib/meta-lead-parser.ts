// Pure TypeScript parser for raw Meta (Facebook) Lead Ads form text.
// No external dependencies — safe to import in client components.
//
// Meta's lead notification paste looks like:
//
//   Hello! I filled out your form and would like to know more about your business.
//   Email: rdayana1104@icloud.com
//   Full name: Robin Dayana Castaneda
//   Phone number: (760) 619-4526
//   City: Coachella
//   Are you a home owner: Yes
//
// Unlike the partner-lead paste (positional, unlabeled lines — see
// partner-lead-parser.ts), Meta's format is `Label: value` per line, so this
// parser is a simple label-anchored line scan. Any label we don't recognize
// (e.g. "Are you a home owner:", or any other custom Meta form question) is
// silently ignored rather than enumerated.

export interface ParsedMetaLead {
  full_name: string | null
  email:     string | null
  phone:     string | null
  city:      string | null
  raw:       string
}

const LABEL_PATTERNS: { key: keyof Omit<ParsedMetaLead, "raw">; pattern: RegExp }[] = [
  { key: "full_name", pattern: /^full\s*name\s*:\s*(.+)$/i },
  { key: "email",     pattern: /^email\s*:\s*(.+)$/i },
  { key: "phone",     pattern: /^phone(?:\s*number)?\s*:\s*(.+)$/i },
  { key: "city",      pattern: /^city\s*:\s*(.+)$/i },
]

// Normalizes a phone value to (XXX) XXX-XXXX when it's a 10-digit US number
// (or 11 digits starting with a leading 1). Otherwise returns the trimmed
// captured text as-is rather than discarding it.
function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "")
  const tenDigit = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits
  if (tenDigit.length === 10) {
    return `(${tenDigit.slice(0, 3)}) ${tenDigit.slice(3, 6)}-${tenDigit.slice(6)}`
  }
  return raw.trim()
}

export function parseMetaLeadText(raw: string): ParsedMetaLead {
  const result: ParsedMetaLead = { full_name: null, email: null, phone: null, city: null, raw }

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    for (const { key, pattern } of LABEL_PATTERNS) {
      if (result[key] !== null) continue // first match wins, don't overwrite
      const m = line.match(pattern)
      if (m) {
        const value = m[1].trim()
        if (!value) continue
        result[key] = key === "phone" ? normalizePhone(value) : value
        break
      }
    }
  }

  return result
}
