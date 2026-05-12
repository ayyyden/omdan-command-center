// ─── Partner Lead Detector ────────────────────────────────────────────────────
// Detects and parses raw partner/company lead messages before they reach the
// AI fallback. This prevents Claude from misclassifying structured lead
// messages as estimate drafts or other actions based on conversation history.

// ─── Category code → readable label ──────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  Rm: "Remodel",  rm: "Remodel",  RM: "Remodel",
  LA: "Landscaping", La: "Landscaping", la: "Landscaping",
  Ro: "Roofing",  ro: "Roofing",  RO: "Roofing",
  Pa: "Painting", pa: "Painting", PA: "Painting",
  Pl: "Plumbing", pl: "Plumbing", PL: "Plumbing",
  El: "Electrical", el: "Electrical", EL: "Electrical",
  GC: "General Construction", gc: "General Construction",
  Dr: "Drainage", dr: "Drainage", DR: "Drainage",
  Ha: "Hardscape", ha: "Hardscape", HA: "Hardscape",
  Co: "Concrete", co: "Concrete", CO: "Concrete",
  Fe: "Fence",    fe: "Fence",    FE: "Fence",
  De: "Deck",     de: "Deck",     DE: "Deck",
  Ki: "Kitchen Remodel",   ki: "Kitchen Remodel",
  Ba: "Bathroom Remodel",  ba: "Bathroom Remodel",
  Wd: "Window & Door",     wd: "Window & Door",
  St: "Stucco",   st: "Stucco",   ST: "Stucco",
  Fr: "Framing",  fr: "Framing",  FR: "Framing",
  Fl: "Flooring", fl: "Flooring", FL: "Flooring",
  Ti: "Tile",     ti: "Tile",     TI: "Tile",
  Du: "Debris Removal", du: "Debris Removal",
}

export interface ParsedPartnerLead {
  name:              string | null
  phone:             string | null
  address:           string | null
  scheduled_date:    string | null   // YYYY-MM-DD
  start_time:        string | null   // HH:MM (24h)
  end_time:          string | null   // HH:MM (24h)
  partner_reference: string | null   // e.g. "5586"
  category_code:     string | null
  project_summary:   string | null   // human-readable
  notes:             string | null
}

// ─── Detection ────────────────────────────────────────────────────────────────
// Must pass at least 3 of 5 signals to avoid false positives.

export function isRawPartnerLead(text: string): boolean {
  const hasDate      = /\b(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+\w{3,9}\s+\d{1,2},?\s+\d{4}/i.test(text)
  const hasTimeRange = /\d{1,2}:\d{2}\s*(?:am|pm)\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm)/i.test(text)
  const hasPhone     = /(?:^|\n)\s*\d{10}\s*(?:\n|$)/.test(text)
  const hasAddress   = /\d+\s+\w[^\n]*(?:st|ave|blvd|dr|rd|way|ln|ct|pl|cir|hwy|pkwy|terr?|trail)\b/i.test(text)
  const hasRef       = /#\d{3,6}/.test(text)

  const signals = [hasDate, hasTimeRange, hasPhone, hasAddress, hasRef]
  const count   = signals.filter(Boolean).length
  return count >= 3
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function parseDate(text: string): string | null {
  const m = text.match(/(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+)?(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/i)
  if (!m) return null
  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)]
  if (!month) return null
  return `${m[3]}-${month.toString().padStart(2, "0")}-${parseInt(m[2], 10).toString().padStart(2, "0")}`
}

function parseTime12(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  if (m[3].toLowerCase() === "am" && h === 12) h = 0
  if (m[3].toLowerCase() === "pm" && h !== 12) h += 12
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`
}

function parseTimeRange(line: string): { start: string | null; end: string | null } {
  const m = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm))\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i)
  if (m) return { start: parseTime12(m[1]), end: parseTime12(m[2]) }
  const s = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i)
  if (s) return { start: parseTime12(s[1]), end: null }
  return { start: null, end: null }
}

function extractPhone(line: string): string | null {
  const c = line.replace(/[^\d]/g, "")
  if (c.length === 10) return c
  if (c.length === 11 && c.startsWith("1")) return c.slice(1)
  return null
}

function looksLikeAddress(line: string): boolean {
  return /^\d+\s+\w/.test(line.trim()) &&
    /(?:st|ave|blvd|dr|rd|way|ln|ct|pl|cir|hwy|pkwy|terr?|trail)\b/i.test(line)
}

function looksLikeCategoryCode(line: string): boolean {
  return /^[A-Za-z]{1,4}$/.test(line.trim())
}

// ─── Full parser ──────────────────────────────────────────────────────────────

export function parseRawPartnerLead(raw: string): ParsedPartnerLead {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean)

  let scheduled_date:    string | null = null
  let partner_reference: string | null = null
  let start_time:        string | null = null
  let end_time:          string | null = null
  let name:              string | null = null
  let phone:             string | null = null
  let address:           string | null = null
  let category_code:     string | null = null
  const notesLines:      string[]      = []
  let pastCategoryCode                 = false

  for (const line of lines) {
    // Date + optional ref on same line
    if (!scheduled_date) {
      const dateVal = parseDate(line)
      if (dateVal) {
        scheduled_date = dateVal
        const refMatch = line.match(/#(\d+)/)
        if (refMatch) partner_reference = refMatch[1]
        continue
      }
    }

    // Standalone ref "#5586"
    if (!partner_reference) {
      const refMatch = line.match(/^#(\d+)$/)
      if (refMatch) { partner_reference = refMatch[1]; continue }
    }

    // Time range
    if (!start_time) {
      const { start, end } = parseTimeRange(line)
      if (start) { start_time = start; end_time = end; continue }
    }

    // Phone
    if (!phone) {
      const p = extractPhone(line)
      if (p) { phone = p; continue }
    }

    // Address
    if (!address && looksLikeAddress(line)) {
      address = line; continue
    }

    // Category code (short alpha token after address and name are found)
    if (!category_code && !pastCategoryCode && looksLikeCategoryCode(line)) {
      category_code = line.trim()
      pastCategoryCode = true
      continue
    }

    // Name: first 1-4 word alphabetic line before category code
    if (!name && !pastCategoryCode && !/\d/.test(line) && line.split(/\s+/).length <= 4) {
      name = line; continue
    }

    // Notes: everything after category code
    if (pastCategoryCode) {
      notesLines.push(line)
    }
  }

  const project_summary = category_code
    ? (CATEGORY_LABELS[category_code] ?? category_code)
    : null

  return {
    name,
    phone,
    address,
    scheduled_date,
    start_time,
    end_time,
    partner_reference,
    category_code,
    project_summary,
    notes: notesLines.join("\n").trim() || null,
  }
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatPhone(phone: string | null): string | null {
  if (!phone) return null
  const d = phone.replace(/[^0-9]/g, "")
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return phone
}

function formatDateFull(dateStr: string | null): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr + "T12:00:00")
    return d.toLocaleDateString("en-US", {
      weekday: "short", month: "long", day: "numeric", year: "numeric",
    })
  } catch { return dateStr }
}

function formatTime12Display(t: string | null): string | null {
  if (!t) return null
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12    = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

export function formatLeadApptPreview(approvalId: string, parsed: ParsedPartnerLead): string {
  const lines: string[] = ["📍 Scheduled Lead — Pending Approval", ""]

  if (parsed.name)              lines.push(`👤 Customer: ${parsed.name}`)
  if (parsed.phone)             lines.push(`📞 Phone: ${formatPhone(parsed.phone) ?? parsed.phone}`)
  if (parsed.address)           lines.push(`📍 Address: ${parsed.address}`)

  if (parsed.scheduled_date) {
    const datePart = formatDateFull(parsed.scheduled_date)
    const timePart = parsed.start_time
      ? [formatTime12Display(parsed.start_time), formatTime12Display(parsed.end_time)]
          .filter(Boolean).join(" - ")
      : null
    lines.push(`📅 Appointment: ${datePart}${timePart ? `, ${timePart}` : ""}`)
  } else if (parsed.start_time) {
    lines.push(`🕐 Time: ${[formatTime12Display(parsed.start_time), formatTime12Display(parsed.end_time)].filter(Boolean).join(" - ")}`)
  }

  lines.push(`📌 Lead Source: Partner Lead`)
  if (parsed.partner_reference) lines.push(`🔖 Reference: #${parsed.partner_reference}`)
  if (parsed.project_summary)   lines.push(`🛠 Project: ${parsed.project_summary}`)

  if (parsed.notes) {
    lines.push("", "📝 Notes:")
    lines.push(parsed.notes.slice(0, 400) + (parsed.notes.length > 400 ? "…" : ""))
  }

  lines.push("", `ID: ${approvalId}`)
  return lines.join("\n")
}
