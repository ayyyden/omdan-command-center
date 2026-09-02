// Mirrors src/lib/expense-categories.ts in the main CRM app — lia-bridge is
// a separate Node project and can't import across the repo boundary, so
// this list is duplicated. Keep the two in sync if categories ever change.
export const EXPENSE_CATEGORIES = [
  "materials", "labor", "subcontractors", "permits", "dump_fees",
  "equipment", "gas", "vehicle", "tools", "office_rent", "software",
  "insurance", "marketing", "meals", "travel",
  "utilities", "office_supplies", "professional_services",
  "misc",
] as const

export function expenseCategoryLabel(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}
