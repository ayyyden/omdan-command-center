// Shared estimate formatting — used by the PDF, the email, the approval page
// and the estimate form, so they all read the scope and show the details the
// same way. Safe to import from client components (no server-only code).

import { parseStructuredText } from "@/lib/contracts/text-layout"

/** How many days an estimate stays valid after it's sent. */
export const ESTIMATE_VALID_DAYS = 15

/** Company details printed on every estimate (PDF, email, approval page). */
export const ESTIMATE_COMPANY = {
  name:    "Omdan Development Inc.",
  phone:   "(951) 929-0703",
  email:   "info@omdandevelopment.com",
  license: "1148568",
}

export const ESTIMATE_TERMS = [
  `This estimate is valid for ${ESTIMATE_VALID_DAYS} days from the date above. After that date, pricing may change.`,
  "Payments are due at each milestone listed in the payment schedule.",
  "Changes or additional work require a written change order and may change the price.",
  "Signing accepts this scope, price and payment schedule.",
]

export function estimateNumberLabel(n: number | null | undefined): string | null {
  return n ? `E-${n}` : null
}

export interface ScopeSection { heading: string; bullets: string[] }
export interface ParsedScope { intro: string[]; sections: ScopeSection[] }

/**
 * Reads scope_of_work text — "1. Heading" lines with "- bullet" / "* bullet"
 * lines under them (what "Write it for me" produces) — into sections.
 * Older free-text scopes still work: "Heading:" lines become sections and
 * loose paragraphs become an intro.
 */
export function parseScope(text: string | null | undefined): ParsedScope {
  const out: ParsedScope = { intro: [], sections: [] }
  if (!text?.trim()) return out
  let cur: ScopeSection | null = null
  for (const it of parseStructuredText(text)) {
    if (it.kind === "blank") continue
    if (it.kind === "heading") {
      cur = { heading: it.text.replace(/^\(?\d{1,2}[.)]\s*/, "").replace(/:\s*$/, "").trim(), bullets: [] }
      out.sections.push(cur)
    } else if (cur) {
      cur.bullets.push(it.text)
    } else {
      out.intro.push(it.text)
    }
  }
  return out
}

/** Sections → the text stored in scope_of_work. */
export function serializeScope(sections: ScopeSection[]): string {
  return sections
    .filter((s) => s.heading.trim())
    .map((s, i) => [`${i + 1}. ${s.heading.trim()}`, ...s.bullets.filter((b) => b.trim()).map((b) => `- ${b.trim()}`)].join("\n"))
    .join("\n\n")
}

/** Notes field → one note per line, bullets stripped. */
export function parseNotes(text: string | null | undefined): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*([*\-•·]|\d{1,2}[.)])\s+/, "").trim())
    .filter(Boolean)
}

export function formatMoney(n: number): string {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Long US date pinned to Pacific time (server and browser agree). */
export function formatLongDate(d: string | Date | null | undefined): string {
  if (!d) return ""
  const date = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00Z") : new Date(d)
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" })
}

/** YYYY-MM-DD in Pacific time, `days` from now. */
export function pacificDatePlus(days: number): string {
  const d = new Date(Date.now() + days * 86400000)
  return d.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
}

/** The standard email sent with an estimate (editable in the Send dialog). */
export function defaultEstimateEmail(customerName: string, title: string) {
  const first = customerName.trim().split(/\s+/)[0] || "there"
  return {
    subject: `Your estimate from Omdan Development — ${title}`,
    body: `Hi ${first},

Thank you for meeting with us. As discussed, here is your estimate for the ${title.toLowerCase()}. You can review the full scope of work and payment schedule, then approve and sign online using the button below. A PDF copy is attached.

If you have any questions, just reply to this email or call us at ${ESTIMATE_COMPANY.phone}.`,
  }
}
