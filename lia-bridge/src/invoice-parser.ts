// Natural language parser for invoice messages.
// Handles patterns like:
//   "Lia, send invoice to John Smith for $2500 for deposit"
//   "Lia, create invoice for Lisa Newell for $5000 final payment"
//   "Lia, invoice Test Customer $1500 for materials deposit due Friday"

export interface ParsedInvoice {
  customer_name?: string
  amount?: number
  type?: string     // deposit | progress | final | custom string
  notes?: string
  due_date?: string // YYYY-MM-DD
}

// ─── Money ────────────────────────────────────────────────────────────────────

function parseMoneyAmount(raw: string): number | undefined {
  const s = raw.replace(/[$,\s]/g, "").toLowerCase()
  if (s.endsWith("k")) {
    const n = parseFloat(s.slice(0, -1))
    return isNaN(n) ? undefined : n * 1_000
  }
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}

// ─── Due date ─────────────────────────────────────────────────────────────────

const WEEKDAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"]
const MONTHS_LONG  = ["january","february","march","april","may","june","july","august","september","october","november","december"]
const MONTHS_SHORT = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"]

function toLocalDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(d)
}

function parseDueDate(text: string): string | undefined {
  const lower = text.toLowerCase()

  // YYYY-MM-DD
  const isoM = lower.match(/due\s+(\d{4}-\d{2}-\d{2})/)
  if (isoM) return isoM[1]

  // MM/DD or MM/DD/YYYY
  const mdM = lower.match(/due\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/)
  if (mdM) {
    const year = mdM[3] ? parseInt(mdM[3], 10) : new Date().getFullYear()
    return `${year}-${mdM[1].padStart(2, "0")}-${mdM[2].padStart(2, "0")}`
  }

  // Month DD  e.g. "due January 15" / "due Jan 15"
  const monthRe = new RegExp(
    `due\\s+(${[...MONTHS_LONG, ...MONTHS_SHORT].join("|")})\\s+(\\d{1,2})`
  )
  const monthM = lower.match(monthRe)
  if (monthM) {
    const name = monthM[1]
    const idx  = MONTHS_LONG.indexOf(name) !== -1
      ? MONTHS_LONG.indexOf(name)
      : MONTHS_SHORT.indexOf(name)
    if (idx !== -1) {
      const year = new Date().getFullYear()
      return `${year}-${String(idx + 1).padStart(2, "0")}-${monthM[2].padStart(2, "0")}`
    }
  }

  // Named weekday: "due Friday"
  for (let i = 0; i < WEEKDAYS.length; i++) {
    if (lower.includes(`due ${WEEKDAYS[i]}`)) {
      const d = new Date()
      let diff = i - d.getDay()
      if (diff <= 0) diff += 7
      d.setDate(d.getDate() + diff)
      return toLocalDate(d)
    }
  }

  // "due in N days"
  const daysM = lower.match(/due\s+in\s+(\d+)\s+days?/)
  if (daysM) {
    const d = new Date()
    d.setDate(d.getDate() + parseInt(daysM[1], 10))
    return toLocalDate(d)
  }

  return undefined
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseInvoiceMessage(raw: string): ParsedInvoice {
  const result: ParsedInvoice = {}

  // Normalize: remove "Lia, " prefix
  const text = raw.replace(/^lia\s*[,.]?\s*/i, "").trim()

  // Strip invoice/bill lead-in and capture everything after it
  const stripped = text
    .replace(
      /^(?:please\s+)?(?:send\s+(?:an?\s+)?invoice\s+(?:to|for)|create\s+(?:an?\s+)?invoice\s+(?:for|to)?|send\s+(?:an?\s+)?invoice|invoice\s+(?:to|for)|invoice|bill\s+(?:to|for)?|bill)\s*/i,
      "",
    )
    .trim()

  // ── Amount ──────────────────────────────────────────────────────────────────
  // Prefer $N forms; also accept bare Nk patterns; 3+ digit bare numbers last
  const amountRe = /\$[\d,]+(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?k\b|\b\d[\d,]{2,}(?:\.\d{1,2})?\b/
  const amountM  = stripped.match(amountRe)

  if (amountM?.index !== undefined) {
    result.amount = parseMoneyAmount(amountM[0])

    // Customer name = text before the amount, stripped of trailing "for"
    const before = stripped.slice(0, amountM.index)
      .replace(/\s+for\s*$/i, "")
      .replace(/[,\s]+$/, "")
      .trim()
    if (before.length >= 2) result.customer_name = before
  } else {
    // No amount found — everything might be a customer name
    result.customer_name = stripped.trim() || undefined
  }

  // ── Due date ────────────────────────────────────────────────────────────────
  result.due_date = parseDueDate(text)

  // ── Type ────────────────────────────────────────────────────────────────────
  const lower = text.toLowerCase()
  if (/\bfinal\b/.test(lower))         result.type = "final"
  else if (/\bprogress\b/.test(lower)) result.type = "progress"
  else if (/\bdeposit\b/.test(lower))  result.type = "deposit"
  // Default set by CRM if not provided

  // ── Notes ───────────────────────────────────────────────────────────────────
  // Look for "for <description>" after the amount that isn't just a type keyword
  if (amountM?.index !== undefined) {
    const after = stripped.slice(amountM.index + amountM[0].length)
    const notesM = after.match(
      /for\s+([\w\s]{3,60}?)(?=\s+(?:deposit|final|progress)\b|\s+due\b|$)/i,
    )
    if (notesM) {
      const candidate = notesM[1].trim()
      if (!/^(?:deposit|final|progress|payment\s+methods?)$/i.test(candidate)) {
        result.notes = candidate
      }
    }
  }

  return result
}
