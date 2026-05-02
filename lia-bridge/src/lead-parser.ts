// Natural language parser for lead + estimate messages.
// Handles the format Lia expects from the owner, e.g.:
//   "Lia add this lead:
//    name - Revital Watchel
//    phone 888-888-8888
//    email revitalwachtel13@gmail.com
//    needs painting, pavers, turf
//    charge 55k
//    payment schedule: 1000 deposit, 14000 demo, 25000 material arrival, 15000 job done"

export interface ParsedLead {
  name?: string
  phone?: string
  email?: string
  service_type?: string
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

function parsePaymentSchedule(text: string): ParsedPaymentStep[] {
  // Find the section starting with "payment schedule:"
  const secMatch = text.match(/payment\s+schedule[:\s]+([\s\S]+?)(?=\nmake\b|\nsend\b|make an\b|$)/i)
  const section = secMatch ? secMatch[1] : ""
  if (!section.trim()) return []

  const steps: ParsedPaymentStep[] = []
  // Split on commas or newlines, then parse each "amount label" entry
  const parts = section.split(/[,\n]/).map((s) => s.trim()).filter(Boolean)

  for (const part of parts) {
    // "1000 deposit"  →  amount=1000, name="Deposit"
    const m = part.match(/^(\d[\d,]*(?:k)?)\s+(.{2,60})$/i)
    if (m) {
      const amount = parseMoneyAmount(m[1])
      if (amount !== undefined) {
        steps.push({ name: capitalize(m[2]), amount })
      }
    }
  }
  return steps
}

export function parseLeadEstimateMessage(text: string): ParsedLeadEstimate {
  const result: ParsedLeadEstimate = { lead: {}, wants_estimate: false }

  // Name: "name - Foo Bar"  or  "name: Foo Bar"
  const nameM = text.match(/\bname\s*[-:]\s*([^\n,]+)/i)
  if (nameM) result.lead.name = nameM[1].trim()

  // Phone: "phone 888-888-8888" first; fall back to any phone pattern
  const phoneM =
    text.match(/\bphone\s+([+\d][\d\s\-().]{6,18})/i) ??
    text.match(/\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/)
  if (phoneM) result.lead.phone = phoneM[1].trim()

  // Email
  const emailM = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/)
  if (emailM) result.lead.email = emailM[0]

  // Services: "needs painting, pavers, turf"
  const servicesM = text.match(/\bneeds?\s+([^\n]+)/i)
  if (servicesM) result.lead.service_type = servicesM[1].trim()

  // Detect if an estimate is wanted
  const wantsEstimate = /\bestimate\b|charge\s+\$?[\d,]+|payment schedule/i.test(text)
  result.wants_estimate = wantsEstimate

  if (wantsEstimate) {
    const est: ParsedEstimate = {}

    if (servicesM) est.services = servicesM[1].trim()

    // Total: "charge 55k"  or  "total: $55,000"
    const chargeM =
      text.match(/\bcharge\s+(\$?[\d,]+k?)/i) ??
      text.match(/\btotal\s*[:\s]+(\$?[\d,]+k?)/i)
    if (chargeM) est.total = parseMoneyAmount(chargeM[1])

    const steps = parsePaymentSchedule(text)
    if (steps.length) est.payment_steps = steps

    // Manually provided scope: "Scope:" or "Scope of work:" followed by text
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
