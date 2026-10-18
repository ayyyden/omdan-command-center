// The order fields are asked for on the signing form (customer) and the
// Prepare step (staff). Fields with a "Fill order" number set in the field
// editor (options.order) come first, lowest number first; the rest follow
// in reading order — page, then top to bottom, then left to right.

interface Orderable {
  page_number: number
  x?: number | null
  y?: number | null
  options?: { order?: number | null } | null
}

export function fillOrderOf(f: Orderable): number | null {
  const n = f.options?.order
  return typeof n === "number" && n > 0 ? n : null
}

export function sortForFilling<T extends Orderable>(fields: T[]): T[] {
  return [...fields].sort((a, b) => {
    const oa = fillOrderOf(a) ?? Infinity, ob = fillOrderOf(b) ?? Infinity
    if (oa !== ob) return oa - ob
    if (a.page_number !== b.page_number) return a.page_number - b.page_number
    const dy = (a.y ?? 0) - (b.y ?? 0)
    // same printed line (within ~0.6% of the page) → left to right
    if (Math.abs(dy) > 0.006) return dy
    return (a.x ?? 0) - (b.x ?? 0)
  })
}
