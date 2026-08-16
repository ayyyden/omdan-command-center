// Shared "what day is it in LA" helpers — schedule-parser.ts and
// invoice-parser.ts each used to reimplement this independently (and
// invoice-parser.ts's version had a real bug: it did weekday/day-count
// arithmetic on the server's own local date — UTC on the VPS — before
// converting to LA, so "due Friday" or "due in N days" could resolve to
// the wrong day whenever it was evening in LA but already tomorrow UTC).
//
// Usage pattern: get today via getLADate() (returns a Date built from LA's
// calendar Y/M/D, not the real current instant), do all arithmetic on it
// with the plain local getters/setters (getDay, setDate, getDate, ...),
// then read the result back out with toYMD(). Don't mix in
// Intl.DateTimeFormat-based timezone conversion on these Dates — they're
// not real instants, they're LA calendar days encoded as local-component
// Dates, and round-tripping them through a timezone-instant conversion
// re-introduces the exact day-shift bug this exists to avoid.

export function getLADate(): Date {
  const laStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
  const [y, m, d] = laStr.split("-").map(Number)
  return new Date(y, m - 1, d)
}

export function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}
