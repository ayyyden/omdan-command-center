// Natural language parser for lead + estimate messages.
// Handles both strict formats ("name: Foo Bar") and messy natural text
// ("name idan slik", "client need to do turf job", "make the estimate for 45k").

export interface ParsedLead {
  name?: string
  phone?: string
  email?: string
  address?: string
  service_type?: string
  lead_source?: string
}

export interface ParsedPaymentStep {
  name: string
  amount: number
}

export interface ParsedEstimate {
  services?: string
  total?: number
  payment_steps?: ParsedPaymentStep[]
  scope_override?: string  // text from "Scope:" or "Scope of work:" section
}

export interface ParsedLeadEstimate {
  lead: ParsedLead
  estimate?: ParsedEstimate
  wants_estimate: boolean
}

// ─── Money parsing ─────────────────────────────────────────────────────────────

function parseMoneyAmount(raw: string): number | undefined {
  const s = raw.replace(/[$,\s]/g, "").toLowerCase()
  if (s.endsWith("k")) {
    const n = parseFloat(s.slice(0, -1))
    return isNaN(n) ? undefined : n * 1_000
  }
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}

function capitalize(s: string): string {
  const t = s.trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ─── Lead source normalization ─────────────────────────────────────────────────
// Maps common keywords to lead_sources.value identifiers.
// The CHECK constraint was dropped in migration 040, so unlisted values are OK.

const LEAD_SOURCE_KEYWORDS: Array<[string, string]> = [
  ["nextdoor",         "nextdoor"],
  ["instagram",        "instagram"],
  [" ig ",             "instagram"],
  ["facebook",         "facebook"],
  [" fb ",             "facebook"],
  ["meta",             "facebook"],
  ["google",           "google"],
  ["yelp",             "yelp"],
  ["referral",         "referral"],
  ["referred",         "referral"],
  ["yard sign",        "yard_sign"],
  ["door knock",       "door_knock"],
  ["repeat customer",  "repeat_customer"],
]

function normalizeLeadSource(raw: string): string {
  const padded = ` ${raw.toLowerCase().trim()} `
  for (const [keyword, value] of LEAD_SOURCE_KEYWORDS) {
    if (padded.includes(keyword)) return value
  }
  return raw.toLowerCase().trim().replace(/\s+/g, "_")
}

// ─── Name extraction ───────────────────────────────────────────────────────────

function extractName(text: string): string | undefined {
  // 1. Strict separators: "name - Foo" or "name: Foo"
  const strict = text.match(/\bname\s*[-:]\s*([^\n,]{2,60})/i)
  if (strict) return strict[1].trim()

  // 2. "name is Foo Bar"
  const nameIs = text.match(/\bname\s+is\s+([^\n,]{2,60})/i)
  if (nameIs) return nameIs[1].trim()

  // 3. Loose line-anchored: "name Foo Bar" (2–4 name-like words, whole line only)
  //    Checked BEFORE customer/client so "name idan slik" is never mis-parsed
  //    as a customer/client sentence.
  const loose = text.match(/^name\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+){1,3})\s*$/im)
  if (loose) return loose[1].trim()

  // 4. "customer/client [name is] Foo Bar"
  //    Negative lookahead blocks action-verb phrases so "client need to do X"
  //    is never captured as a name. Repetition also stops at action verbs so
  //    "client John Smith needs pavers" yields "John Smith" not "John Smith needs".
  const custClient = text.match(
    /\b(?:customer|client)(?:'s)?\s+(?:name\s+(?:is\s+)?)?(?!(?:need|needs|want|wants|would|has|have|require[sd]?|looking|asked)\b)([A-Za-z][A-Za-z'-]+(?:\s+(?!needs?\b|wants?\b|would\b|has\b|have\b|require[sd]?\b|looking\b|asked\b)[A-Za-z][A-Za-z'-]+){0,3})/i,
  )
  if (custClient) return custClient[1].trim()

  return undefined
}

// ─── Address extraction ────────────────────────────────────────────────────────

function extractAddress(text: string): string | undefined {
  // Line-anchored to avoid matching "email address" mid-sentence
  const m = text.match(/^address\s*[-:]?\s*([^\n]{10,150})/im)
  return m ? m[1].trim() : undefined
}

// ─── Lead source extraction ────────────────────────────────────────────────────

function extractLeadSource(text: string): string | undefined {
  const m =
    text.match(/\blead\s+source\s*[-:]\s*([^\n]{2,60})/i) ??
    text.match(/\bgot\s+the\s+lead\s+from\s+([^\n]{2,60})/i) ??
    text.match(/\b(?:lead|it)\s+from\s+([^\n]{2,60})/i)
  if (!m) return undefined
  // Stop at sentence continuations
  const raw = m[1].split(/\s+the\s+(?:client|customer)|\s+they\s+|\s+and\s+the\s+/i)[0].trim()
  if (!raw || raw.length < 2) return undefined
  return normalizeLeadSource(raw)
}

// ─── Services extraction ───────────────────────────────────────────────────────

function extractServices(text: string): string | undefined {
  // 1. "needs: painting, pavers, turf"
  const needsM = text.match(/\bneeds?\s*[-:]?\s+([^\n]{5,200})/i)
  if (needsM) return needsM[1].trim()

  // 2. "client/customer need(s)/wants to do/have/get ..."
  const clientM = text.match(
    /\b(?:client|customer)\s+(?:needs?|wants?|would\s+like)\s+to\s+(?:do\s+|have\s+|get\s+|install\s+|build\s+)?(.{10,200})/i,
  )
  if (clientM) return clientM[1].trim()

  return undefined
}

// ─── Payment step parsing ──────────────────────────────────────────────────────

const REST_SENTINEL = -1  // placeholder for "the rest of the total"

function parseStepCandidate(s: string): ParsedPaymentStep | null {
  const t = s.trim()
  if (!t) return null

  // "the rest ...", "remainder ...", "remaining ...", "balance ..."
  const restM = t.match(
    /^(?:the\s+)?(?:rest|remainder|remaining|balance)(?:\s+of\s+(?:it|the\s+(?:payment|balance)))?\s*(.*)/i,
  )
  if (restM) {
    const label = restM[1].trim() || "Final Payment"
    return { name: capitalize(label), amount: REST_SENTINEL }
  }

  // "1000 deposit", "25k when material arrives"
  const amtM = t.match(/^(\$?[\d,]+k?)\s+(.{2,80})/i)
  if (amtM) {
    const amount = parseMoneyAmount(amtM[1])
    if (amount !== undefined) {
      return { name: capitalize(amtM[2].trim()), amount }
    }
  }

  return null
}

function splitPaymentCandidates(section: string): string[] {
  const candidates: string[] = []
  for (const line of section.split(/\n/)) {
    const t = line.trim()
    if (!t) continue
    // "25k when material arrive and the rest when done" → split before "and <rest|number>"
    const parts = t.split(
      /\s+and\s+(?=(?:the\s+)?(?:rest|remainder|remaining|balance)\b|\$?[\d])/i,
    )
    for (const part of parts) {
      for (const chunk of part.split(/\s*,\s*/)) {
        const c = chunk.trim()
        if (c) candidates.push(c)
      }
    }
  }
  return candidates
}

function extractPaymentSteps(text: string, total?: number): ParsedPaymentStep[] {
  // Find payment section after a trigger phrase
  const secM = text.match(
    /(?:payment\s+schedule\s*[-:]?|with\s+\d+\s+payments?\s*[-:]?|payments?\s*[-:]\s*)\s*([\s\S]*)/i,
  )
  if (!secM || !secM[1].trim()) return []

  const candidates = splitPaymentCandidates(secM[1])
  const steps: ParsedPaymentStep[] = []

  for (const c of candidates) {
    const step = parseStepCandidate(c)
    if (step) steps.push(step)
  }

  // Resolve REST_SENTINEL placeholders using total
  if (total !== undefined && total > 0) {
    const knownSum = steps
      .filter((s) => s.amount !== REST_SENTINEL)
      .reduce((acc, s) => acc + s.amount, 0)
    const remainder = Math.max(0, total - knownSum)
    for (const s of steps) {
      if (s.amount === REST_SENTINEL) s.amount = remainder
    }
  }

  return steps.filter((s) => s.amount >= 0)
}

// ─── Main parser ───────────────────────────────────────────────────────────────

export function parseLeadEstimateMessage(text: string): ParsedLeadEstimate {
  const result: ParsedLeadEstimate = { lead: {}, wants_estimate: false }

  // Name
  const name = extractName(text)
  if (name) result.lead.name = name

  // Phone: explicit "phone ..." first, then bare phone pattern
  const phoneM =
    text.match(/\bphone\s+([+\d][\d\s\-().]{6,18})/i) ??
    text.match(/\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/)
  if (phoneM) result.lead.phone = phoneM[1].trim()

  // Email
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  if (emailM) result.lead.email = emailM[0]

  // Address
  const address = extractAddress(text)
  if (address) result.lead.address = address

  // Services
  const services = extractServices(text)
  if (services) result.lead.service_type = services

  // Lead source
  const leadSource = extractLeadSource(text)
  if (leadSource) result.lead.lead_source = leadSource

  // Detect estimate intent
  const wantsEstimate =
    /\bestimate\b|charge\s+\$?[\d,]+k?|total\s+\$?[\d,]+k?|payment\s+schedule|with\s+\d+\s+payments?/i.test(text)
  result.wants_estimate = wantsEstimate

  if (wantsEstimate) {
    const est: ParsedEstimate = {}

    if (services) est.services = services

    // Total: "charge 55k", "total: $55k", "make the estimate for 45k", "estimate for/of 45k"
    const totalM =
      text.match(/\bcharge\s+(\$?[\d,]+k?)/i) ??
      text.match(/\btotal\s*[:\s]+(\$?[\d,]+k?)/i) ??
      text.match(/\bmake\s+(?:the\s+|an?\s+)?estimate\s+for\s+(\$?[\d,]+k?)/i) ??
      text.match(/\bestimate\s+(?:(?:is|of|for)\s+)?(\$?[\d,]+k?)/i)
    if (totalM) est.total = parseMoneyAmount(totalM[1])

    const steps = extractPaymentSteps(text, est.total)
    if (steps.length) est.payment_steps = steps

    // Manually provided scope override: "Scope:" or "Scope of work:"
    const scopeM = text.match(/\bscope(?:\s+of\s+work)?\s*:\s*([\s\S]+)/i)
    if (scopeM) est.scope_override = scopeM[1].trim()

    result.estimate = est
  }

  return result
}

export function missingLeadFields(lead: ParsedLead): string[] {
  const missing: string[] = []
  if (!lead.name) missing.push("customer name")
  return missing
}
