// Pure TypeScript parser for raw partner lead text.
// No external dependencies — safe to import in client components.

export interface ParsedLeadAppointment {
  name:              string | null
  phone:             string | null
  address:           string | null
  scheduled_date:    string | null   // YYYY-MM-DD
  start_time:        string | null   // HH:MM (24h)
  end_time:          string | null   // HH:MM (24h)
  partner_reference: string | null   // numeric ref, e.g. "5586"
  category_code:     string | null   // raw code, e.g. "Rm"
  project_summary:   string | null   // human-readable from category_code
  notes:             string | null
  source:            string          // always "partner"
}

// ─── Category code → readable summary ────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  Rm: "Remodel",
  rm: "Remodel",
  RM: "Remodel",
  LA: "Landscaping",
  La: "Landscaping",
  la: "Landscaping",
  Ro: "Roofing",
  ro: "Roofing",
  RO: "Roofing",
  Pa: "Painting",
  pa: "Painting",
  PA: "Painting",
  Pl: "Plumbing",
  pl: "Plumbing",
  PL: "Plumbing",
  El: "Electrical",
  el: "Electrical",
  EL: "Electrical",
  GC: "General Construction",
  gc: "General Construction",
  Dr: "Drainage",
  dr: "Drainage",
  DR: "Drainage",
  Ha: "Hardscape",
  ha: "Hardscape",
  HA: "Hardscape",
  Co: "Concrete",
  co: "Concrete",
  CO: "Concrete",
  Fe: "Fence",
  fe: "Fence",
  FE: "Fence",
  De: "Deck",
  de: "Deck",
  DE: "Deck",
  Ki: "Kitchen Remodel",
  ki: "Kitchen Remodel",
  KI: "Kitchen Remodel",
  Ba: "Bathroom Remodel",
  ba: "Bathroom Remodel",
  BA: "Bathroom Remodel",
  Wd: "Window & Door",
  wd: "Window & Door",
  WD: "Window & Door",
  St: "Stucco",
  st: "Stucco",
  ST: "Stucco",
  Fr: "Framing",
  fr: "Framing",
  FR: "Framing",
  Fl: "Flooring",
  fl: "Flooring",
  FL: "Flooring",
  Ti: "Tile",
  ti: "Tile",
  TI: "Tile",
  Du: "Dumpster / Debris Removal",
  du: "Dumpster / Debris Removal",
  DU: "Dumpster / Debris Removal",
}

// ─── Date parsing ─────────────────────────────────────────────────────────────
// Parses "Tue May 12, 2026" or "May 12, 2026" → "2026-05-12"

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

function parseDate(text: string): string | null {
  // Pattern: (optional weekday) MonthName Day, Year
  const m = text.match(/(?:(?:mon|tue|wed|thu|fri|sat|sun)\w*\s+)?(\w{3,9})\s+(\d{1,2}),?\s+(\d{4})/i)
  if (!m) return null
  const month = MONTH_MAP[m[1].toLowerCase().slice(0, 3)]
  if (!month) return null
  const day   = parseInt(m[2], 10)
  const year  = parseInt(m[3], 10)
  return `${year}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`
}

// ─── Time parsing ─────────────────────────────────────────────────────────────
// Parses "02:00 pm" or "2:00pm" → "14:00"
// Also handles "02:00 pm -03:00 pm" → start="14:00", end="15:00"

function parseTime12(t: string): string | null {
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const period = m[3].toLowerCase()
  if (period === "am" && h === 12) h = 0
  if (period === "pm" && h !== 12) h += 12
  return `${h.toString().padStart(2, "0")}:${min.toString().padStart(2, "0")}`
}

function parseTimeRange(line: string): { start: string | null; end: string | null } {
  // Match "HH:MM am/pm - HH:MM am/pm" (various spacing/dash styles)
  const m = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm))\s*[-–—]\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i)
  if (m) {
    return { start: parseTime12(m[1]), end: parseTime12(m[2]) }
  }
  // Single time
  const single = line.match(/(\d{1,2}:\d{2}\s*(?:am|pm))/i)
  if (single) {
    return { start: parseTime12(single[1]), end: null }
  }
  return { start: null, end: null }
}

// ─── Phone parsing ────────────────────────────────────────────────────────────

function extractPhone(line: string): string | null {
  const cleaned = line.replace(/[^\d]/g, "")
  if (cleaned.length === 10) return cleaned
  if (cleaned.length === 11 && cleaned.startsWith("1")) return cleaned.slice(1)
  return null
}

// ─── Address detection ────────────────────────────────────────────────────────
// A line looks like an address if it contains a street number + street name

function looksLikeAddress(line: string): boolean {
  return /^\d+\s+\w/.test(line.trim()) &&
    /(?:st|ave|blvd|dr|rd|way|ln|ct|pl|cir|hwy|pkwy|terr?|trail)\b/i.test(line)
}

// ─── Category code detection ─────────────────────────────────────────────────
// A line is a category code if it's 1–4 chars of only letters

function looksLikeCategoryCode(line: string): boolean {
  return /^[A-Za-z]{1,4}$/.test(line.trim())
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parsePartnerLead(raw: string): ParsedLeadAppointment {
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
  let pastCategoryCode               = false

  for (const line of lines) {
    // Date + optional partner reference on same line: "Tue May 12, 2026  #5586"
    if (!scheduled_date) {
      const dateVal = parseDate(line)
      if (dateVal) {
        scheduled_date = dateVal
        // Extract ref # from same line
        const refMatch = line.match(/#(\d+)/)
        if (refMatch) partner_reference = refMatch[1]
        continue
      }
    }

    // Standalone partner reference: "#5586"
    if (!partner_reference) {
      const refMatch = line.match(/^#(\d+)$/)
      if (refMatch) { partner_reference = refMatch[1]; continue }
    }

    // Time range: "02:00 pm -03:00 pm"
    if (!start_time) {
      const { start, end } = parseTimeRange(line)
      if (start) { start_time = start; end_time = end; continue }
    }

    // Phone number
    if (!phone) {
      const p = extractPhone(line)
      if (p) { phone = p; continue }
    }

    // Address
    if (!address && looksLikeAddress(line)) {
      address = line; continue
    }

    // Category code — short alpha-only token after address
    if (!category_code && address && looksLikeCategoryCode(line)) {
      category_code = line.trim()
      pastCategoryCode = true
      continue
    }

    // Name: first un-matched line of 1–4 words (before category code), no digits
    if (!name && !pastCategoryCode && !/\d/.test(line) && line.split(/\s+/).length <= 4) {
      name = line; continue
    }

    // Everything after category code goes to notes
    if (pastCategoryCode) {
      notesLines.push(line)
    }
  }

  // If no category code was found, remaining non-matched lines are notes
  if (!pastCategoryCode) {
    // Collect lines that look like notes (not date, time, phone, address, name)
    for (const line of lines) {
      if (line === name || line === address || line === category_code) continue
      if (parseDate(line) || parseTimeRange(line).start || extractPhone(line)) continue
      if (looksLikeCategoryCode(line)) continue
      if (scheduled_date && line.includes(scheduled_date)) continue
      if (!notesLines.includes(line)) notesLines.push(line)
    }
  }

  const project_summary = category_code
    ? (CATEGORY_LABELS[category_code] ?? category_code)
    : null

  const notes = notesLines.join("\n").trim() || null

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
    notes,
    source: "partner",
  }
}

// ─── City extractor (for scheduler display) ───────────────────────────────────

export function extractCity(address: string | null): string | null {
  if (!address) return null
  // "11221 Roxabel St, Santa Fe Springs, California 90670"
  // Split by comma → second part is city
  const parts = address.split(",")
  if (parts.length >= 2) return parts[1].trim()
  return null
}
