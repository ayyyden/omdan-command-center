// PropStream CSV parser
// Handles quirks: "76" blank placeholder, DNC flags, phone normalization,
// multi-column phone/email fields, flexible column-name matching.

import Papa from "papaparse"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ParsedPhone {
  phone: string        // E.164-normalized, e.g. "+12135551234"
  phone_type: string | null
  position: number    // 1–5
}

export interface ParsedLead {
  owner_name:         string | null
  owner2_name:        string | null
  property_address:   string | null
  property_city:      string | null
  property_state:     string | null
  property_zip:       string | null
  property_county:    string | null
  apn:                string | null
  mailing_address:    string | null
  owner_occupied:     boolean | null
  property_type:      string | null
  bedrooms:           number | null
  bathrooms:          number | null
  sqft:               number | null
  lot_sqft:           number | null
  year_built:         number | null
  assessed_value:     number | null
  last_sale_date:     string | null  // ISO date string
  last_sale_amount:   number | null
  estimated_value:    number | null
  estimated_equity:   number | null
  estimated_ltv:      number | null
  open_loans_count:   number | null
  open_loans_balance: number | null
  mls_status:         string | null
  mls_date:           string | null
  mls_amount:         number | null
  emails:             string[]
  phones:             ParsedPhone[]
  has_callable_phone: boolean
  raw_data:           Record<string, string>
}

export interface ImportSummary {
  row_count:      number
  imported_count: number
  callable_count: number
  no_phone_count: number
  dnc_removed:    number
  dupe_removed:   number
  skipped_count:  number
}

// ─── Column name normalizer ───────────────────────────────────────────────────

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function buildColMap(row: Record<string, string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const key of Object.keys(row)) {
    map.set(normalizeKey(key), key)
  }
  return map
}

function getCol(colMap: Map<string, string>, row: Record<string, string>, ...aliases: string[]): string | null {
  for (const alias of aliases) {
    const normalized = normalizeKey(alias)
    const actualKey = colMap.get(normalized)
    if (actualKey !== undefined) {
      const val = row[actualKey]?.trim()
      // "76" is PropStream's blank placeholder — treat as empty
      if (val && val !== "76") return val
      return null
    }
  }
  return null
}

// ─── Phone normalization ──────────────────────────────────────────────────────

function normalizePhone(raw: string | null): string | null {
  if (!raw || raw.trim() === "76") return null
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return null  // invalid
}

function isDNC(val: string | null): boolean {
  if (!val) return false
  return ["true", "yes", "1", "y"].includes(val.toLowerCase().trim())
}

// ─── Value parsers ────────────────────────────────────────────────────────────

function parseNum(val: string | null): number | null {
  if (!val) return null
  const n = parseFloat(val.replace(/[$,%]/g, ""))
  return isNaN(n) ? null : n
}

function parseInt2(val: string | null): number | null {
  if (!val) return null
  const n = parseInt(val.replace(/[^0-9-]/g, ""), 10)
  return isNaN(n) ? null : n
}

function parseDate(val: string | null): string | null {
  if (!val) return null
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return null
    return d.toISOString().substring(0, 10)
  } catch {
    return null
  }
}

function parseBool(val: string | null): boolean | null {
  if (!val) return null
  const lower = val.toLowerCase().trim()
  if (["yes", "true", "1", "y"].includes(lower)) return true
  if (["no", "false", "0", "n"].includes(lower)) return false
  return null
}

function parseEmail(val: string | null): string | null {
  if (!val) return null
  const trimmed = val.trim()
  return trimmed.includes("@") ? trimmed : null
}

// ─── Main row parser ──────────────────────────────────────────────────────────

function parseRow(row: Record<string, string>, colMap: Map<string, string>): ParsedLead | null {
  const g = (...a: string[]) => getCol(colMap, row, ...a)

  // Names
  const fn1 = g("Owner 1 First Name", "First Name")
  const ln1 = g("Owner 1 Last Name", "Last Name")
  const fn2 = g("Owner 2 First Name")
  const ln2 = g("Owner 2 Last Name")
  const owner_name  = [fn1, ln1].filter(Boolean).join(" ") || null
  const owner2_name = [fn2, ln2].filter(Boolean).join(" ") || null

  // If no owner name at all, skip this row
  if (!owner_name) return null

  // Property address
  const addr    = g("Address", "Property Address")
  const unit    = g("Unit #", "Unit")
  const city    = g("City", "Property City")
  const state   = g("State", "Property State")
  const zip     = g("Zip", "Zip Code", "Property Zip")
  const county  = g("County", "Property County")
  const apn     = g("APN")

  const fullAddr = addr
    ? (unit ? `${addr} Unit ${unit}` : addr)
    : null

  // Mailing address — PropStream exports several mailing fields; combine the most common ones
  const mailStreet = g("Mailing Address", "Mail Address", "Mailing Street")
  const mailCity   = g("Mailing City")
  const mailState  = g("Mailing State")
  const mailZip    = g("Mailing Zip", "Mailing Zip Code")
  const mailingParts = [mailStreet, mailCity, mailState, mailZip].filter(Boolean)
  const mailing_address = mailingParts.length > 0 ? mailingParts.join(", ") : null

  // Phone numbers (positions 1–5)
  const phones: ParsedPhone[] = []
  let dnc_removed_count = 0

  for (let i = 1; i <= 5; i++) {
    const rawPhone    = g(`Phone ${i}`)
    const rawType     = g(`Phone ${i} Type`)
    const rawDNC      = g(`Phone ${i} DNC`)
    if (!rawPhone) continue
    if (isDNC(rawDNC)) { dnc_removed_count++; continue }
    const normalized  = normalizePhone(rawPhone)
    if (!normalized) continue
    phones.push({ phone: normalized, phone_type: rawType, position: i })
  }

  // Deduplicate phones (keep first occurrence)
  const seen = new Set<string>()
  let dupe_removed_count = 0
  const uniquePhones = phones.filter((p) => {
    if (seen.has(p.phone)) { dupe_removed_count++; return false }
    seen.add(p.phone)
    return true
  })

  // Emails 1–4
  const emails: string[] = []
  for (let i = 1; i <= 4; i++) {
    const e = parseEmail(g(`Email ${i}`))
    if (e) emails.push(e)
  }

  return {
    owner_name,
    owner2_name,
    property_address: fullAddr,
    property_city:    city,
    property_state:   state,
    property_zip:     zip,
    property_county:  county,
    apn,
    mailing_address,
    owner_occupied:   parseBool(g("Owner Occupied")),
    property_type:    g("Property Type"),
    bedrooms:         parseInt2(g("Bedrooms", "Beds")),
    bathrooms:        parseNum(g("Total Bathrooms", "Bathrooms", "Baths")),
    sqft:             parseInt2(g("Building Sqft", "Building Sq Ft", "Sqft", "Sq Ft")),
    lot_sqft:         parseInt2(g("Lot Size Sqft", "Lot Sqft", "Lot Size Sq Ft")),
    year_built:       parseInt2(g("Effective Year Built", "Year Built")),
    assessed_value:   parseNum(g("Total Assessed Value", "Assessed Value")),
    last_sale_date:   parseDate(g("Last Sale Recording Date", "Last Sale Date")),
    last_sale_amount: parseNum(g("Last Sale Amount")),
    estimated_value:  parseNum(g("Est. Value", "Estimated Value")),
    estimated_equity: parseNum(g("Est. Equity", "Estimated Equity")),
    estimated_ltv:    parseNum(g("Est. Loan-to-Value", "Est. LTV", "LTV")),
    open_loans_count: parseInt2(g("Total Open Loans")),
    open_loans_balance: parseNum(g("Est. Remaining balance of Open Loans", "Open Loans Balance")),
    mls_status:       g("MLS Status"),
    mls_date:         parseDate(g("MLS Date")),
    mls_amount:       parseNum(g("MLS Amount")),
    emails,
    phones:           uniquePhones,
    has_callable_phone: uniquePhones.length > 0,
    raw_data: row,
    // internal counters available via closure — returned in summary
    _dnc_removed:  dnc_removed_count,
    _dupe_removed: dupe_removed_count,
  } as ParsedLead & { _dnc_removed: number; _dupe_removed: number }
}

// ─── Public parse function ────────────────────────────────────────────────────

export interface ParseResult {
  leads:   ParsedLead[]
  summary: Omit<ImportSummary, "imported_count">
}

export function parseCSV(csvText: string): ParseResult {
  // Strip UTF-8 BOM if present
  const cleaned = csvText.startsWith("﻿") ? csvText.slice(1) : csvText

  const parsed = Papa.parse<Record<string, string>>(cleaned, {
    header:         true,
    skipEmptyLines: true,
  })

  const rows = parsed.data
  let dnc_removed = 0
  let dupe_removed = 0
  let skipped_count = 0

  const leads: ParsedLead[] = []

  for (const row of rows) {
    const colMap = buildColMap(row)
    const lead = parseRow(row, colMap) as (ParsedLead & { _dnc_removed?: number; _dupe_removed?: number }) | null
    if (!lead) { skipped_count++; continue }
    dnc_removed  += (lead as any)._dnc_removed  ?? 0
    dupe_removed += (lead as any)._dupe_removed ?? 0
    delete (lead as any)._dnc_removed
    delete (lead as any)._dupe_removed
    leads.push(lead)
  }

  return {
    leads,
    summary: {
      row_count:      rows.length,
      callable_count: leads.filter((l) => l.has_callable_phone).length,
      no_phone_count: leads.filter((l) => !l.has_callable_phone).length,
      dnc_removed,
      dupe_removed,
      skipped_count,
    },
  }
}
