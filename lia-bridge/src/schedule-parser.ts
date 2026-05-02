// Parses natural language scheduling requests into structured data.
// All dates are resolved in America/Los_Angeles timezone.

export interface ParsedScheduleMessage {
  customer_name: string | null
  job_title_hint: string | null
  scheduled_date: string | null  // YYYY-MM-DD
  scheduled_time: string | null  // HH:MM
  missing: string[]
}

// Construction-related words that can appear as job title descriptors
const CONSTRUCTION_WORDS = new Set([
  "backyard", "front", "back", "yard", "paver", "pavers", "paving",
  "turf", "roof", "roofing", "floor", "flooring", "paint", "painting",
  "fence", "fencing", "deck", "pool", "concrete", "stucco", "drywall",
  "tile", "bathroom", "kitchen", "garage", "bedroom", "living", "patio",
  "landscaping", "lawn", "irrigation", "plumbing", "electrical", "hvac",
  "ac", "framing", "foundation", "insulation", "siding", "window", "door",
  "exterior", "interior", "remodel", "renovation", "addition", "grading",
  "demolition", "cleanup", "repair", "installation", "driveway", "walkway",
  "retaining", "wall", "drainage", "gutter", "soffit", "fascia",
])

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, fri: 5, sat: 6,
}

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// ── Date/time helpers ────────────────────────────────────────────────────────

function getLADate(): Date {
  const laStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
  const [y, m, d] = laStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function parseTime(text: string): string | null {
  const lower = text.toLowerCase()
  const m = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (m) {
    let h = parseInt(m[1])
    const min = parseInt(m[2] ?? "0")
    if (m[3] === "pm" && h !== 12) h += 12
    if (m[3] === "am" && h === 12) h = 0
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`
  }
  if (/\bmorning\b/.test(lower)) return "09:00"
  if (/\bafternoon\b/.test(lower)) return "13:00"
  if (/\bevening\b/.test(lower)) return "17:00"
  return null
}

function parseDate(text: string): string | null {
  const lower = text.toLowerCase()
  const today = getLADate()

  if (/\btoday\b/.test(lower)) return toYMD(today)

  if (/\btomorrow\b/.test(lower)) {
    const d = new Date(today)
    d.setDate(d.getDate() + 1)
    return toYMD(d)
  }

  // "next [day]" — always skips to the next week occurrence
  const nextDayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|fri|sat|sun)\b/)
  if (nextDayMatch) {
    const target = DAY_NAMES[nextDayMatch[1]]
    const d = new Date(today)
    let days = target - today.getDay()
    if (days <= 0) days += 7
    d.setDate(d.getDate() + days)
    return toYMD(d)
  }

  // Plain "[day]" — next upcoming occurrence (if today is that day, go to next week)
  for (const [name, num] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      const d = new Date(today)
      let days = num - today.getDay()
      if (days <= 0) days += 7
      d.setDate(d.getDate() + days)
      return toYMD(d)
    }
  }

  // "May 10", "October 3", etc. — month must be followed by a number
  for (const [name, monthNum] of Object.entries(MONTH_NAMES)) {
    const rx = new RegExp(`\\b${name}\\s+(\\d{1,2})\\b`)
    const mMatch = lower.match(rx)
    if (mMatch) {
      const day = parseInt(mMatch[1])
      const d = new Date(today.getFullYear(), monthNum - 1, day)
      if (d < today) d.setFullYear(today.getFullYear() + 1)
      return toYMD(d)
    }
  }

  // "MM/DD"
  const numDate = lower.match(/\b(\d{1,2})\/(\d{1,2})\b/)
  if (numDate) {
    const month = parseInt(numDate[1])
    const day = parseInt(numDate[2])
    const d = new Date(today.getFullYear(), month - 1, day)
    if (d < today) d.setFullYear(today.getFullYear() + 1)
    return toYMD(d)
  }

  return null
}

// Remove date/time tokens from text so entity extraction is clean
function stripDateTimeTokens(text: string): string {
  let s = text
  // Strip "next [day]" before plain day names
  s = s.replace(/\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|fri|sat|sun)\b/gi, " ")
  // Strip plain day names
  s = s.replace(/\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|fri|sat|sun)\b/gi, " ")
  // Strip "Month DD"
  s = s.replace(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{1,2}\b/gi, " ")
  // Strip MM/DD
  s = s.replace(/\b\d{1,2}\/\d{1,2}\b/g, " ")
  // Strip time (9am, 8:30am, etc.)
  s = s.replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, " ")
  // Strip time words
  s = s.replace(/\b(?:tomorrow|today|morning|afternoon|evening)\b/gi, " ")
  return s
}

// ── Entity parsing: separate customer name from job title hint ───────────────

function parseEntityText(text: string): { customer_name: string | null; job_title_hint: string | null } {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // "the [job title]" → no customer name
  if (lower.startsWith("the ")) {
    const hint = trimmed.slice(4).trim()
    return { customer_name: null, job_title_hint: hint || null }
  }

  // Find the last occurrence of " job" to split customer from job hint
  const jobIdx = lower.lastIndexOf(" job")
  if (jobIdx === -1) {
    // No "job" keyword — whole entity is the customer name
    return { customer_name: trimmed || null, job_title_hint: null }
  }

  const beforeJobText = trimmed.slice(0, jobIdx).trim()
  const words = beforeJobText.split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return { customer_name: null, job_title_hint: "job" }
  }
  if (words.length === 1) {
    // Only one word before "job" — no room for a customer name
    return { customer_name: null, job_title_hint: `${words[0]} job` }
  }

  // Check if second-to-last word is a construction descriptor → include it in the hint
  const secondToLast = words[words.length - 2]?.toLowerCase() ?? ""
  const hintWordCount = CONSTRUCTION_WORDS.has(secondToLast) ? 2 : 1

  const hintWords = words.slice(words.length - hintWordCount)
  const customerWords = words.slice(0, words.length - hintWordCount)

  return {
    customer_name: customerWords.join(" ") || null,
    job_title_hint: [...hintWords, "job"].join(" ") || null,
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseScheduleMessage(text: string): ParsedScheduleMessage {
  // Strip "Lia" prefix and action verb
  let working = text
    .replace(/^lia[,\s]*/i, "")
    .replace(/^(?:schedule|book)\s+/i, "")
    .replace(/^put\s+/i, "")
    .trim()

  // Remove "on the calendar/schedule" phrasing (from "put X on the calendar for...")
  working = working.replace(/\s+on\s+the\s+(?:calendar|schedule)\b\s*/i, " ").trim()

  const scheduled_time = parseTime(working)
  const scheduled_date = parseDate(working)

  // Strip date/time tokens to isolate the entity (customer + job)
  let entityText = stripDateTimeTokens(working)
  // Remove transition words left over
  entityText = entityText
    .replace(/\bfor\b/gi, " ")
    .replace(/\bat\b/gi, " ")
    .replace(/\bon\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim()

  const { customer_name, job_title_hint } = parseEntityText(entityText)

  const missing: string[] = []
  if (!scheduled_date) missing.push("date")

  return { customer_name, job_title_hint, scheduled_date, scheduled_time, missing }
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatScheduledDate(date: string): string {
  try {
    return new Date(date + "T00:00:00").toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    })
  } catch { return date }
}

export function formatScheduledTime(time: string | null | undefined): string {
  if (!time) return "Time TBD"
  try {
    const [h, m] = time.split(":").map(Number)
    const d = new Date(2000, 0, 1, h, m)
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  } catch { return time }
}
