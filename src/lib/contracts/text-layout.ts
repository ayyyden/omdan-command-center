// Lays out long, structured text (numbered headings, bullet lists, plain
// paragraphs) inside a multiline contract box so it fits AND stays easy to
// read — e.g. a full scope of work typed into the Addendum's "Description of
// Work" lines. Tries, in order of how natural it looks:
//   one column → one column without blank lines → two balanced columns
//   → (ruled boxes only) two rows of text per printed line
// and picks the one that keeps the text largest, with a small penalty for
// each less natural option. Pure layout, no drawing: stamp-pdf.ts draws it.

export type Align = "left" | "center" | "right"

export interface Run { text: string; bold: boolean; dx: number }
export interface PlacedLine { runs: Run[]; col: number; row: number; align: Align; width: number }

export interface LayoutResult {
  size: number
  /** Distance between rows of text, in pt */
  pitch: number
  cols: number
  colWidth: number
  gutter: number
  /** Rows of text per column the box holds at this size/pitch */
  rows: number
  /** Rows used by the tallest column */
  rowsUsed: number
  lines: PlacedLine[]
  fits: boolean
  /** true when two rows of text share each printed line */
  half: boolean
}

interface Fonts { regular: any; bold: any }

type Item =
  | { kind: "blank" }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "item"; text: string; marker: string; level: number }

export const MIN_READABLE = 6.5
const COMFORT = 9

// ── Parsing ──────────────────────────────────────────────────────────────

const BULLET_RE = /^(\s*)([*\-•·▪◦●○■□►▸➢>–—+])\s+(.*\S)\s*$/
const NUMBER_RE = /^(\s*)(\(?\d{1,2}[.)]|\(?[A-Za-z][.)])\s+(.*\S)\s*$/

export function parseStructuredText(value: string): Item[] {
  const raw = value.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")
  type Pre = { kind: "blank" } | { kind: "bullet" | "number" | "para"; text: string; marker: string; indent: number }
  const pre: Pre[] = raw.map((line) => {
    if (!line.trim()) return { kind: "blank" }
    let m = line.match(BULLET_RE)
    if (m) return { kind: "bullet", indent: m[1].length, marker: m[2], text: m[3] }
    m = line.match(NUMBER_RE)
    if (m) return { kind: "number", indent: m[1].length, marker: m[2], text: m[3] }
    return { kind: "para", indent: line.length - line.trimStart().length, marker: "", text: line.trim() }
  })

  const nextContent = (i: number) => { for (let j = i + 1; j < pre.length; j++) if (pre[j].kind !== "blank") return pre[j]; return null }
  const baseIndent = Math.min(...pre.filter((p) => p.kind !== "blank").map((p) => (p as any).indent as number), 99)

  const items: Item[] = []
  pre.forEach((p, i) => {
    if (p.kind === "blank") {
      // collapse runs of blank lines, never lead with one
      if (items.length && items[items.length - 1].kind !== "blank") items.push({ kind: "blank" })
      return
    }
    const next = nextContent(i)
    const leadsList = !!next && next.kind !== "para" && next.kind !== "blank" && (next.kind === "bullet" || (next as any).indent > p.indent) && !(p.kind === "number" && next.kind === "number" && (next as any).indent <= p.indent)
    const letters = p.text.replace(/[^A-Za-z]/g, "")
    const allCaps = letters.length >= 3 && letters === letters.toUpperCase() && p.text.length <= 70
    const colonLead = /:\s*$/.test(p.text) && p.text.length <= 90

    if (p.kind !== "bullet" && (leadsList || allCaps || (colonLead && !!next))) {
      items.push({ kind: "heading", text: p.kind === "number" ? `${p.marker} ${p.text}` : p.text })
      return
    }
    if (p.kind === "para") { items.push({ kind: "para", text: p.text }); return }
    const level = p.indent - baseIndent >= 2 ? 1 : 0
    const marker = p.kind === "number" ? p.marker : level ? "–" : "•"
    items.push({ kind: "item", text: p.text, marker, level })
  })
  while (items.length && items[items.length - 1].kind === "blank") items.pop()
  return items
}

/** True when the text has structure worth laying out (lists / headings / several paragraphs). */
export function isStructured(items: Item[]): boolean {
  return items.some((i) => i.kind === "item" || i.kind === "heading")
}

// ── Wrapping ─────────────────────────────────────────────────────────────

function widthOf(font: any, text: string, size: number): number {
  try { return font.widthOfTextAtSize(text, size) } catch { return text.length * size * 0.5 }
}

function wrap(text: string, maxWidth: number, font: any, size: number): string[] {
  const out: string[] = []
  let cur = ""
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = cur ? `${cur} ${word}` : word
    if (widthOf(font, test, size) <= maxWidth || !cur) {
      cur = test
    } else {
      out.push(cur)
      cur = word
    }
    // A single word wider than the box: break it by characters
    while (widthOf(font, cur, size) > maxWidth && cur.length > 1) {
      let k = cur.length - 1
      while (k > 1 && widthOf(font, cur.slice(0, k), size) > maxWidth) k--
      out.push(cur.slice(0, k))
      cur = cur.slice(k)
    }
  }
  if (cur) out.push(cur)
  return out
}

interface VLine { runs: Run[]; align: Align; width: number; blank?: boolean; heading?: boolean; cont?: boolean }

function buildLines(items: Item[], colW: number, size: number, fonts: Fonts, keepBlanks: boolean, align: Align, allBold: boolean): VLine[] {
  const lines: VLine[] = []
  const f = (bold: boolean) => (bold || allBold ? fonts.bold : fonts.regular)
  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx]
    if (it.kind === "blank") {
      // a blank line right under a heading only wastes a row
      const prev = lines[lines.length - 1]
      if (keepBlanks && prev && !prev.heading) lines.push({ runs: [], align: "left", width: 0, blank: true })
      continue
    }
    if (it.kind === "heading" || it.kind === "para") {
      const bold = it.kind === "heading"
      const a: Align = bold ? "left" : align
      wrap(it.text, colW, f(bold), size).forEach((t, k) =>
        lines.push({ runs: [{ text: t, bold: bold || allBold, dx: 0 }], align: a, width: widthOf(f(bold), t, size), heading: bold, cont: k > 0 }))
      continue
    }
    const indent = it.level * size * 1.1
    const markerW = widthOf(f(false), it.marker, size)
    const textX = indent + Math.max(markerW + size * 0.45, size * 0.95)
    wrap(it.text, colW - textX, f(false), size).forEach((t, k) => {
      const runs: Run[] = k === 0 ? [{ text: it.marker, bold: allBold, dx: indent }, { text: t, bold: allBold, dx: textX }] : [{ text: t, bold: allBold, dx: textX }]
      lines.push({ runs, align: "left", width: textX + widthOf(f(false), t, size), cont: k > 0 })
    })
  }
  // no blank line at the very top/bottom
  while (lines.length && lines[0].blank) lines.shift()
  while (lines.length && lines[lines.length - 1].blank) lines.pop()
  return lines
}

function trimmed(lines: VLine[]): VLine[] {
  let a = 0, b = lines.length
  while (a < b && lines[a].blank) a++
  while (b > a && lines[b - 1].blank) b--
  return lines.slice(a, b)
}

/** Best place to start the second column, or null if the text can't fit in two. */
function splitColumns(lines: VLine[], rows: number, sectionsOnly: boolean): [VLine[], VLine[]] | null {
  let best: { cost: number; i: number } | null = null
  for (let i = 1; i < lines.length; i++) {
    const a = trimmed(lines.slice(0, i)), b = trimmed(lines.slice(i))
    if (!a.length || !b.length || a.length > rows || b.length > rows) continue
    const last = a[a.length - 1], first = b[0]
    if (last.heading) continue                         // never leave a heading alone at the bottom
    let cost = Math.max(a.length, b.length)
    const sectionStart = first.heading && !first.cont
    if (sectionsOnly && !sectionStart) continue
    if (!sectionStart) cost += 2.5                     // prefer starting column 2 with a new section
    if (first.cont) cost += 4                          // avoid splitting one wrapped bullet in two
    if (!best || cost < best.cost) best = { cost, i }
  }
  if (!best) return null
  return [trimmed(lines.slice(0, best.i)), trimmed(lines.slice(best.i))]
}

// ── Fitting ──────────────────────────────────────────────────────────────

export interface LayoutBox {
  width: number
  height: number
  /** Ruled box: printed-line spacing + gap of the baseline above each line */
  lineSpacing?: number
  baselineGap?: number
  /** Free box: line height multiplier */
  lineHeight?: number
  maxSize: number
  align: Align
  allBold: boolean
}

// sections: column 2 may only start at a heading (keeps each section whole)
interface Config { cols: 1 | 2; keepBlanks: boolean; half: boolean; sections?: boolean }

export function layoutText(value: string, box: LayoutBox, fonts: Fonts): LayoutResult {
  const items = parseStructuredText(value)
  const ruled = !!box.lineSpacing && box.lineSpacing > 0
  const twoColOk = box.width >= 220
  const gutterFor = (size: number) => Math.max(12, size * 1.8)

  const configs: Config[] = [
    { cols: 1, keepBlanks: true, half: false },
    { cols: 1, keepBlanks: false, half: false },
    ...(twoColOk ? [
      { cols: 2 as const, keepBlanks: true, half: false, sections: true }, { cols: 2 as const, keepBlanks: false, half: false, sections: true },
      { cols: 2 as const, keepBlanks: true, half: false }, { cols: 2 as const, keepBlanks: false, half: false },
    ] : []),
    ...(ruled ? [{ cols: 1 as const, keepBlanks: false, half: true }] : []),
    ...(ruled && twoColOk ? [{ cols: 2 as const, keepBlanks: false, half: true }] : []),
  ]

  const metrics = (c: Config, size: number) => {
    if (ruled) {
      const s = box.lineSpacing!
      const printed = Math.max(1, Math.floor((box.height + 0.5) / s))
      // Half pitch: rows on every printed line and halfway between them,
      // starting ON the first line (never above it, where printed words sit)
      return c.half ? { pitch: s / 2, rows: printed * 2 - 1 } : { pitch: s, rows: printed }
    }
    const pitch = size * (box.lineHeight ?? 1.3)
    return { pitch, rows: Math.max(1, Math.floor((box.height + 0.01) / pitch)) }
  }
  const maxFor = (c: Config) => {
    if (!ruled) return box.maxSize
    const gap = box.baselineGap ?? 2.5
    if (!c.half) return Math.min(box.maxSize, box.lineSpacing! - gap - 1)
    // Rows halfway between printed lines: the letters (~0.75 em tall) must
    // clear the line above them, so this only works on widely spaced lines
    return Math.min(box.maxSize, (box.lineSpacing! / 2 - gap - 1.5) / 0.75)
  }

  const attempt = (c: Config, size: number): LayoutResult => {
    const { pitch, rows } = metrics(c, size)
    const gutter = c.cols === 2 ? gutterFor(size) : 0
    const colWidth = c.cols === 2 ? (box.width - gutter) / 2 : box.width
    const lines = buildLines(items, colWidth, size, fonts, c.keepBlanks, box.align, box.allBold)
    let cols: VLine[][] = [lines]
    let fits = lines.length <= rows
    if (c.cols === 2) {
      const split = fits ? null : splitColumns(lines, rows, !!c.sections)
      if (split) { cols = split; fits = true }
    }
    const placed: PlacedLine[] = []
    cols.forEach((col, ci) => col.forEach((l, r) => { if (!l.blank) placed.push({ runs: l.runs, col: ci, row: r, align: l.align, width: l.width }) }))
    return {
      size, pitch, rows, gutter, colWidth: cols.length === 2 ? colWidth : box.width, cols: cols.length,
      rowsUsed: Math.max(...cols.map((c2) => c2.length)), lines: placed, fits, half: c.half,
    }
  }

  const bestFit = (c: Config): LayoutResult | null => {
    for (let size = maxFor(c); size >= MIN_READABLE - 0.001; size -= 0.25) {
      const r = attempt(c, Math.round(size * 4) / 4)
      if (r.fits) return r
    }
    return null
  }

  // Each layout's best size, minus a small "looks less natural" cost:
  // dropping blank lines < two columns < splitting a section across columns
  // < two rows per printed line. Size beyond COMFORT earns nothing extra.
  const hasSections = items.some((i) => i.kind === "heading")
  const cost = (c: Config) =>
    (c.keepBlanks ? 0 : 0.25) + (c.cols === 2 ? 0.5 : 0) + (c.cols === 2 && !c.sections && hasSections ? 1.5 : 0) + (c.half ? 3 : 0)
  let best: { r: LayoutResult; score: number } | null = null
  for (const c of configs) {
    const r = bestFit(c)
    if (!r) continue
    const score = Math.min(r.size, Math.max(COMFORT, maxFor(configs[0]))) - cost(c)
    if (!best || score > best.score + 0.001) best = { r, score }
  }
  if (best) return best.r

  // Nothing fits even at the smallest readable size: use the roomiest
  // layout at that size and let the caller report the cut-off.
  const usable = configs.filter((c) => maxFor(c) >= MIN_READABLE)
  const last = usable.length ? usable[usable.length - 1] : configs[0]
  return attempt(last, Math.min(MIN_READABLE, maxFor(last)))
}

/** Replaces characters the standard PDF fonts can't draw (emoji, arrows…) so stamping never fails. */
export function sanitizeForFont(text: string, font: any): string {
  const map: Record<string, string> = { "→": "->", "←": "<-", "✓": "", "✔": "", "≈": "~", "≥": ">=", "≤": "<=", " ": " ", "​": "" }
  let out = ""
  for (const ch of text) {
    const c = map[ch] ?? ch
    if (c === "\n") { out += c; continue }
    try { font.widthOfTextAtSize(c, 10); out += c } catch { /* drop it */ }
  }
  return out
}
