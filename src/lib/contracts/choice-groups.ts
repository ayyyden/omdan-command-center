// "Pick one" questions printed on a form — "How would you rate us? (Please
// Circle One) 1. Unsatisfactory … 5. Excellent", or "check YES __ or NOT __".
// Each printed answer gets its own checkbox field in the editor, all with the
// same options.group (the question) and their own options.choice (the
// answer). The signing form shows them as ONE question with buttons; the
// picked answer's field gets "true" (stamped as a circle / check / X per
// options.mark), the others stay empty.

export type ChoiceMark = "check" | "x" | "circle"

interface Groupable {
  id: string
  field_type: string
  label: string
  required: boolean
  options?: { group?: string | null; choice?: string | null } | null
}

export function choiceGroupOf(f: Groupable): string | null {
  if (f.field_type !== "checkbox") return null
  const g = f.options?.group?.trim()
  return g ? g : null
}

export function choiceLabelOf(f: Groupable): string {
  return f.options?.choice?.trim() || f.label
}

export type FormItem<T> =
  | { kind: "field"; field: T }
  | { kind: "choice"; key: string; question: string; required: boolean; members: T[] }

/** Fields → form rows, each choice group collapsed into one question where its first answer sits. */
export function buildFormItems<T extends Groupable>(fields: T[]): FormItem<T>[] {
  const items: FormItem<T>[] = []
  const seen = new Map<string, FormItem<T> & { kind: "choice" }>()
  for (const f of fields) {
    const g = choiceGroupOf(f)
    if (!g) { items.push({ kind: "field", field: f }); continue }
    const existing = seen.get(g)
    if (existing) {
      existing.members.push(f)
      existing.required ||= f.required
      continue
    }
    const item = { kind: "choice" as const, key: g, question: g, required: f.required, members: [f] }
    seen.set(g, item)
    items.push(item)
  }
  return items
}

/** Name of the first required field / question left empty, or null when everything required is filled. */
export function firstMissingRequired<T extends Groupable>(fields: T[], values: Record<string, string>): string | null {
  for (const item of buildFormItems(fields)) {
    if (item.kind === "field") {
      if (item.field.required && !(values[item.field.id] ?? "").trim()) return item.field.label
    } else if (item.required && !item.members.some((m) => values[m.id] === "true")) {
      return item.question
    }
  }
  return null
}

/** Picking one answer clears the others in its group. */
export function pickChoice<T extends Groupable>(members: T[], pickedId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of members) out[m.id] = m.id === pickedId ? "true" : ""
  return out
}
