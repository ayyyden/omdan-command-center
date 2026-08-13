// Single source of truth for expense categories — used by the manual add/edit
// forms, the filter dropdown, both screenshot-import Claude prompts (in-app
// and Telegram), and Lia's create_expense tool. Previously each of those had
// its own hand-copied list and drifted apart (the screenshot importer grew
// 4 extra categories, including "advertising" as a near-duplicate of
// "marketing", that nothing else knew about) — this is the fix, keep every
// category in exactly one place from now on.
export const EXPENSE_CATEGORIES = [
  "materials", "labor", "subcontractors", "permits", "dump_fees",
  "equipment", "gas", "vehicle", "tools", "office_rent", "software",
  "insurance", "marketing", "meals", "travel",
  "utilities", "office_supplies", "professional_services",
  "misc",
] as const

export type ExpenseCategory = typeof EXPENSE_CATEGORIES[number]

export function expenseCategoryLabel(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

// Categorization guidance for the screenshot-import Claude prompts — kept
// next to the category list so the two can never drift apart again.
export const EXPENSE_CATEGORY_HINTS = `
- Home Depot, Lowe's, lumber yards, paver/landscape supply → materials
- Payroll, crew payments → labor
- Payments to subcontracted companies → subcontractors
- City/county permit fees → permits
- Dump/landfill/waste disposal fees → dump_fees
- Equipment rental (excavators, mixers, etc.) → equipment
- Gas stations → gas
- Vehicle repairs, maintenance, registration, insurance for a work vehicle → vehicle
- Small tools, hardware → tools
- Office/shop rent or lease → office_rent
- Software subscriptions (QuickBooks, Adobe, etc.) → software
- Business/liability insurance (not vehicle) → insurance
- Google Ads, Meta/Facebook ads, marketing agencies, printed marketing materials → marketing
- Restaurants, food delivery for the crew → meals
- Hotels, flights, mileage reimbursement → travel
- Electric, water, gas utility, internet, phone bills (AT&T, Verizon, ConEd) → utilities
- Amazon (non-tools), Staples, general office supply stores → office_supplies
- Consulting, legal, accounting fees → professional_services
- Anything that doesn't clearly fit another category → misc
`.trim()
