// Finds the blank fill-in lines on a contract page by looking at its pixels.
// Omdan's contract templates are scans (one image per page — no text, no
// vector lines inside the PDF), so this works the way a person does: long,
// thin, dark horizontal runs with empty space above them are lines to write on.
//
// Output is in page fractions (same coordinate system as contract_fields),
// grouped into suggested fields:
//   - a single line → a text field sitting on it
//   - several evenly spaced, unlabeled lines with the same width → one
//     multiline field in ruled-line mode (one row of text per printed line)

export interface DetectedLine {
  x0: number      // fractions of page width
  x1: number
  y: number       // fraction of page height, center of the printed line
  thickness: number
  /** Lowest point of the line (fraction) — tilted scans run lower at one end */
  bottom: number
}

export interface SuggestedField {
  kind: "text" | "multiline"
  x: number
  y: number
  width: number
  height: number
  lineSpacing?: number   // PT, multiline only
  rows?: number
  /** The printed line(s) this field writes on (fractions of page height) */
  lineYs: number[]
}

interface Opts {
  /** Native page size in PDF points (for pt-based geometry). */
  pdfWidth: number
  pdfHeight: number
}

const DARK = 150                // luminance below this counts as ink
const MIN_LEN_FRAC = 0.05       // a fill-in line is at least ~5% of the page wide
const MAX_THICK_PT = 3.2        // thicker than this is a bar/box, not a line
const EDGE_MARGIN = 0.02        // ignore scan borders

/** Raw horizontal lines in a rendered page. */
export function detectLines(canvas: HTMLCanvasElement, opts: Opts): DetectedLine[] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return []
  const W = canvas.width, H = canvas.height
  const { data } = ctx.getImageData(0, 0, W, H)
  const pxPerPt = W / opts.pdfWidth

  const dark = new Uint8Array(W * H)
  for (let i = 0, p = 0; p < W * H; i += 4, p++) {
    dark[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < DARK ? 1 : 0
  }

  const gapTol = Math.max(1, Math.round(pxPerPt * 0.8))
  const minLen = Math.round(W * MIN_LEN_FRAC)
  const maxThick = Math.max(2, Math.round(MAX_THICK_PT * pxPerPt))
  const yMin = Math.round(H * EDGE_MARGIN), yMax = Math.round(H * (1 - EDGE_MARGIN))
  const xMin = Math.round(W * EDGE_MARGIN), xMax = Math.round(W * (1 - EDGE_MARGIN))

  // 1. Long dark runs per row (small gaps allowed — scans break lines up)
  type Run = { y: number; x0: number; x1: number }
  const rows: Run[][] = []
  for (let y = yMin; y < yMax; y++) {
    const runs: Run[] = []
    let start = -1, lastDark = -1
    for (let x = xMin; x < xMax; x++) {
      if (dark[y * W + x]) {
        if (start < 0) start = x
        lastDark = x
      } else if (start >= 0 && x - lastDark > gapTol) {
        if (lastDark - start >= minLen) runs.push({ y, x0: start, x1: lastDark })
        start = -1
      }
    }
    if (start >= 0 && lastDark - start >= minLen) runs.push({ y, x0: start, x1: lastDark })
    rows[y] = runs
  }

  // 2. Merge runs on neighbouring rows into one line (a line is 1–4 px thick)
  type Line = { x0: number; x1: number; y0: number; y1: number }
  const done: Line[] = []
  let active: Line[] = []
  for (let y = yMin; y < yMax; y++) {
    const next: Line[] = []
    for (const r of rows[y]) {
      const match = active.find((l) => l.y1 === y - 1 && overlap(l.x0, l.x1, r.x0, r.x1) >= 0.7 * Math.min(l.x1 - l.x0, r.x1 - r.x0))
      if (match) {
        match.y1 = y
        match.x0 = Math.min(match.x0, r.x0)
        match.x1 = Math.max(match.x1, r.x1)
        if (!next.includes(match)) next.push(match)
      } else {
        next.push({ x0: r.x0, x1: r.x1, y0: y, y1: y })
      }
    }
    for (const l of active) if (!next.includes(l)) done.push(l)
    active = next
  }
  done.push(...active)

  // 3. Keep thin lines with blank space above them (printed text sitting on a
  //    line means it's an underline/border, not somewhere to write)
  const above = Math.round(12 * pxPerPt), clearance = Math.round(2 * pxPerPt)
  return done
    .filter((l) => l.y1 - l.y0 + 1 <= maxThick)
    .filter((l) => {
      const top = Math.max(0, l.y0 - above), bottom = Math.max(0, l.y0 - clearance)
      let ink = 0, total = 0
      for (let y = top; y < bottom; y++) {
        for (let x = l.x0; x <= l.x1; x += 2) { ink += dark[y * W + x]; total++ }
      }
      return total === 0 || ink / total < 0.04
    })
    .map((l) => ({
      x0: l.x0 / W,
      x1: l.x1 / W,
      y: (l.y0 + l.y1) / 2 / H,
      thickness: (l.y1 - l.y0 + 1) / pxPerPt,
      bottom: l.y1 / H,
    }))
    .sort((a, b) => a.y - b.y || a.x0 - b.x0)
    .reduce(mergeCollinear(4.5 / opts.pdfHeight, 0.012), [] as DetectedLine[])  // slightly tilted scans

  function overlap(a0: number, a1: number, b0: number, b1: number) {
    return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))
  }
}

// Scans break one printed line into pieces (and catch it twice): join pieces
// on the same row that overlap or nearly touch, keeping the full extent.
function mergeCollinear(yTol: number, xGap: number) {
  return (acc: DetectedLine[], l: DetectedLine) => {
    const hit = acc.find((m) => Math.abs(m.y - l.y) <= yTol && l.x0 <= m.x1 + xGap && l.x1 >= m.x0 - xGap)
    if (hit) {
      hit.x0 = Math.min(hit.x0, l.x0)
      hit.x1 = Math.max(hit.x1, l.x1)
      hit.thickness = Math.max(hit.thickness, l.thickness)
      hit.bottom = Math.max(hit.bottom, l.bottom)
    } else {
      acc.push({ ...l })
    }
    return acc
  }
}

function inkRatio(canvas: HTMLCanvasElement, x0: number, y0: number, x1: number, y1: number): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) return 0
  const W = canvas.width, H = canvas.height
  x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0))
  x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1))
  if (x1 <= x0 || y1 <= y0) return 0
  const w = x1 - x0
  // A vertical rule (page frame, table border) runs far above and below the
  // band; a letter's stroke doesn't. Judge rules over a tall strip, count ink
  // only inside the band.
  const tall = Math.round(W * 0.06)
  const ty0 = Math.max(0, y0 - tall), ty1 = Math.min(H, y1 + tall), th = ty1 - ty0
  const { data } = ctx.getImageData(x0, ty0, w, th)
  const isDark = (i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < DARK
  const tallCol = new Uint32Array(w), bandCol = new Uint32Array(w)
  for (let y = 0; y < th; y++) {
    const inBand = ty0 + y >= y0 && ty0 + y < y1
    for (let x = 0; x < w; x++) if (isDark((y * w + x) * 4)) { tallCol[x]++; if (inBand) bandCol[x]++ }
  }
  const skip = new Uint8Array(w)
  const pad = Math.max(2, Math.round(W * 0.004))
  for (let x = 0; x < w; x++) if (tallCol[x] > th * 0.6) for (let d = -pad; d <= pad; d++) if (x + d >= 0 && x + d < w) skip[x + d] = 1
  const edge = W * 0.03, h = y1 - y0
  let ink = 0, cols = 0
  for (let x = 0; x < w; x++) {
    if (skip[x] || x0 + x < edge || x0 + x > W - edge) continue
    ink += bandCol[x]; cols++
  }
  return cols ? ink / (cols * h) : 0
}

/** A caption printed under the line, like "(Owner's Name)" → its own field, never part of a block. */
export function hasCaptionBelow(canvas: HTMLCanvasElement, line: DetectedLine, pdfWidth: number): boolean {
  const W = canvas.width, H = canvas.height, pxPerPt = W / pdfWidth
  const yb = line.bottom * H
  return inkRatio(canvas, line.x0 * W, yb + 2 * pxPerPt, line.x1 * W, yb + 9.5 * pxPerPt) > 0.015
}

/** Is there printed ink (a label) just left of a line, on the same row? */
export function hasLabelLeft(canvas: HTMLCanvasElement, line: DetectedLine, pdfWidth: number): boolean {
  const W = canvas.width, H = canvas.height, pxPerPt = W / pdfWidth
  const x1 = line.x0 * W - 2 * pxPerPt
  const yc = line.y * H
  return inkRatio(canvas, x1 - 60 * pxPerPt, yc - 11 * pxPerPt, x1, yc) > 0.02
}

const TEXT_ABOVE_PT = 13   // box height above a single line
const TEXT_BELOW_PT = 5    // box extends below the line so bottom-aligned text lands just above it

/** Turns detected lines into suggested fields (fractions of the page). */
export function suggestFields(canvas: HTMLCanvasElement, lines: DetectedLine[], opts: Opts): SuggestedField[] {
  const { pdfWidth: pw, pdfHeight: ph } = opts
  const used = new Set<number>()
  const out: SuggestedField[] = []

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue
    const first = lines[i]

    // Collect an evenly spaced stack of same-width, unlabeled lines below this one
    const stack = [i]
    if (!hasLabelLeft(canvas, first, pw) && !hasCaptionBelow(canvas, first, pw)) {
      let spacing = 0
      for (let j = i + 1; j < lines.length; j++) {
        if (used.has(j)) continue
        const prev = lines[stack[stack.length - 1]], cand = lines[j]
        const sameWidth = Math.abs(cand.x0 - first.x0) < 0.025 && Math.abs(cand.x1 - first.x1) < 0.025
        if (!sameWidth) continue
        const gapPt = (cand.y - prev.y) * ph
        // A sliver of the same printed line caught twice — absorb it into the block
        if (gapPt < 6) { stack.push(j); continue }
        if (gapPt < 10 || gapPt > 40) { if (gapPt > 40) break; continue }
        if (spacing && Math.abs(gapPt - spacing) > spacing * 0.2) break
        if (hasLabelLeft(canvas, cand, pw) || hasCaptionBelow(canvas, cand, pw)) break
        spacing = spacing || gapPt
        stack.push(j)
      }
    }

    stack.forEach((k) => used.add(k))
    // Slivers absorbed above don't count as rows
    const rowsIdx = stack.filter((k, n) => n === 0 || (lines[k].y - lines[stack[n - 1]].y) * ph >= 6)
    if (rowsIdx.length >= 2) {
      const ls = rowsIdx.map((k) => lines[k])
      const spacingPt = ((ls[ls.length - 1].y - ls[0].y) * ph) / (ls.length - 1)
      const topPt = ls[0].y * ph - spacingPt
      const heightPt = ls.length * spacingPt + 1.5     // rows × spacing, a hair past the last line
      out.push({
        kind: "multiline",
        x: Math.min(...ls.map((l) => l.x0)),
        y: Math.max(0, topPt / ph),
        width: Math.max(...ls.map((l) => l.x1)) - Math.min(...ls.map((l) => l.x0)),
        height: heightPt / ph,
        lineSpacing: Math.round(spacingPt * 10) / 10,
        rows: ls.length,
        lineYs: ls.map((l) => l.y),
      })
    } else {
      const yPt = first.y * ph
      out.push({
        kind: "text",
        x: first.x0,
        y: Math.max(0, (yPt - TEXT_ABOVE_PT) / ph),
        width: first.x1 - first.x0,
        height: (TEXT_ABOVE_PT + TEXT_BELOW_PT) / ph,
        lineYs: [first.y],
      })
    }
  }
  // Last pass: drop any suggestion that mostly sits inside a bigger one
  // (a block only swallows single lines that are one of its own rows)
  const tol = 3 / ph
  return out.filter((f, n) => !out.some((g, m) => {
    if (m === n || g.width * g.height < f.width * f.height || coverage(f, g) <= 0.6) return false
    if (g.width * g.height === f.width * f.height && m > n) return false
    if (g.kind === "multiline" && f.kind === "text") return f.lineYs.some((y) => g.lineYs.some((gy) => Math.abs(gy - y) <= tol))
    return true
  }))
}

/** Fraction of `a` covered by `b` (boxes as page fractions). */
export function coverage(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): number {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return (w * h) / Math.max(1e-9, a.width * a.height)
}
