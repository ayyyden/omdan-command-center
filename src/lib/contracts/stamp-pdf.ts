// Shared "draw field values onto a PDF" logic — used by both the final
// signing route (/api/contracts/sign/[token], which also adds the audit
// footer line and uploads the result) and the preview route
// (/api/contracts/preview-pdf/[token], which lets a customer see what
// staff already filled in before they ever sign anything). Keeping this in
// one place means the two can never drift out of sync with each other.

import { PDFDocument, rgb, StandardFonts } from "pdf-lib"

export type FieldType = "text" | "multiline" | "date" | "signature" | "initials" | "checkbox" | "yes_no" | "rich_text"
export type VAlign = "top" | "center" | "bottom"

export interface FieldOptions {
  clearBackground?: boolean
  vAlign?: VAlign
  fontSize?: number
  lineHeight?: number
  fontWeight?: "normal" | "bold"
  textAlign?: "left" | "center" | "right"
  padding?: number
}

export interface FieldDef {
  id: string
  page_number: number
  field_type: string
  x: number
  y: number
  width: number
  height: number
  options: FieldOptions | null
}

function defaultVAlign(ft: FieldType): VAlign {
  // Mirrors field-editor.tsx's defaultVAlign — text/date fields sit over a
  // printed ruled line, so they should anchor to the bottom of their box
  // (like handwriting on the line), not float centered.
  if (ft === "signature" || ft === "initials" || ft === "text" || ft === "date") return "bottom"
  if (ft === "rich_text") return "top"
  return "center"
}

const TEXT_COLOR = rgb(0.05, 0.05, 0.1)

// Per-type formatting defaults — mirrors field-editor.tsx TEXT_FORMAT_DEFAULTS.
const TEXT_FORMAT_DEFAULTS = {
  text:       { fontSize: 10, lineHeight: 1.3, fontWeight: "bold"   as const, textAlign: "left"   as const, padding: 2 },
  multiline:  { fontSize: 10, lineHeight: 1.3, fontWeight: "normal" as const, textAlign: "left"   as const, padding: 3 },
  date:       { fontSize: 10, lineHeight: 1.3, fontWeight: "bold"   as const, textAlign: "left"   as const, padding: 2 },
  yes_no:     { fontSize: 11, lineHeight: 1.3, fontWeight: "bold"   as const, textAlign: "center" as const, padding: 2 },
  rich_text:  { fontSize:  9, lineHeight: 1.4, fontWeight: "normal" as const, textAlign: "left"   as const, padding: 4 },
} as const

// Browser <input> renders text slightly above mathematical center due to internal padding.
// This constant nudges PDF text upward to match what the signer saw on screen.
// Increase if text still appears too low in the signed PDF; decrease if it appears too high.
const PDF_FLATTEN_Y_OFFSET = 3  // PDF points

// Returns the Y baseline for a single line of text inside a field box.
// PDF origin is bottom-left; cap-height ≈ 0.7×size means baseline = center - 0.35×size.
// PDF_FLATTEN_Y_OFFSET compensates for browser input internal vertical padding.
function textBaseline(vAlign: VAlign, py: number, fh: number, size: number, pad: number): number {
  if (vAlign === "bottom") return py + pad + size * 0.25 + PDF_FLATTEN_Y_OFFSET
  if (vAlign === "top")    return py + fh - pad - size * 0.75 + PDF_FLATTEN_Y_OFFSET
  return py + fh / 2 - size * 0.35 + PDF_FLATTEN_Y_OFFSET  // center
}

// Draws text with a subtle white halo so it reads cleanly over PDF lines/content.
function drawTextWithHalo(page: any, text: string, x: number, y: number, size: number, font: any) {
  const halo = rgb(1, 1, 1)
  const offsets: [number, number][] = [[-0.5, 0], [0.5, 0], [0, -0.5], [0, 0.5]]
  for (const [dx, dy] of offsets) {
    page.drawText(text, { x: x + dx, y: y + dy, size, font, color: halo, opacity: 0.65 })
  }
  page.drawText(text, { x, y, size, font, color: TEXT_COLOR })
}

// Returns the largest font size ≤ start that fits text within maxWidth, down to min.
function fitFontSize(text: string, maxWidth: number, font: any, start: number, min: number): number {
  let size = start
  while (size > min) {
    try {
      if (font.widthOfTextAtSize(text, size) <= maxWidth) return size
    } catch {
      return size
    }
    size -= 0.5
  }
  return min
}

// Returns the X origin for a line given horizontal alignment.
function alignedX(text: string, align: "left" | "center" | "right", boxLeft: number, boxWidth: number, font: any, size: number): number {
  if (align === "left") return boxLeft
  try {
    const tw = font.widthOfTextAtSize(text, size)
    if (align === "center") return boxLeft + (boxWidth - tw) / 2
    return boxLeft + boxWidth - tw  // right
  } catch {
    return boxLeft
  }
}

// Like wrapText but also splits on explicit \n from textarea input.
function wrapRichText(text: string, maxWidth: number, font: any, size: number): string[] {
  const lines: string[] = []
  for (const para of text.split("\n")) {
    if (!para.trim()) {
      lines.push("")  // preserve blank lines
    } else {
      lines.push(...wrapText(para, maxWidth, font, size))
    }
  }
  return lines
}

function wrapText(text: string, maxWidth: number, font: any, size: number): string[] {
  const words = text.split(" ")
  const lines: string[] = []
  let current = ""
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    try {
      const w = font.widthOfTextAtSize(test, size)
      if (w > maxWidth && current) {
        lines.push(current)
        current = word
      } else {
        current = test
      }
    } catch {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso + "T00:00:00")
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
  } catch {
    return iso
  }
}

/**
 * Draws every field value onto its page in place. Fields with no value
 * (not yet filled by whoever owns them) are simply skipped — this is what
 * lets the preview route stamp only staff_field_values and leave the
 * customer's still-blank fields exactly as blank lines.
 */
export async function stampFieldsOntoPdf(
  pdfDoc: PDFDocument,
  fieldDefs: FieldDef[],
  fieldValues: Record<string, string>,
): Promise<void> {
  const pages = pdfDoc.getPages()

  const font       = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont    = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  for (const def of fieldDefs) {
    const value = fieldValues[def.id] ?? ""
    if (!value && def.field_type !== "checkbox") continue

    const pageIndex = (def.page_number ?? 1) - 1
    const page = pages[Math.min(pageIndex, pages.length - 1)]
    if (!page) continue

    const { width: pw, height: ph } = page.getSize()

    // Fractions → PDF points; Y flipped (PDF origin = bottom-left)
    const px = def.x * pw
    const py = ph - (def.y * ph) - (def.height * ph)
    const fw = def.width  * pw
    const fh = def.height * ph

    const opts: FieldOptions = def.options ?? {}
    const clearBg = opts.clearBackground === true  // default false
    const vAlign: VAlign = opts.vAlign ?? defaultVAlign(def.field_type as FieldType)

    // Optional white clear rectangle — only when explicitly enabled per field
    if (clearBg) {
      const isSig = def.field_type === "signature" || def.field_type === "initials"
      const ep = isSig ? 6 : 2
      page.drawRectangle({
        x: px - ep, y: py - ep,
        width: fw + ep * 2, height: fh + ep * 2,
        color: rgb(1, 1, 1),
      })
    }

    switch (def.field_type) {
      case "text": {
        if (!value) break
        const d    = TEXT_FORMAT_DEFAULTS.text
        const pad  = opts.padding   ?? d.padding
        const align = (opts.textAlign ?? d.textAlign) as "left" | "center" | "right"
        const ftFont = (opts.fontWeight ?? d.fontWeight) === "bold" ? boldFont : font
        const size = fitFontSize(value, fw - pad * 2, ftFont, Math.min(opts.fontSize ?? d.fontSize, fh * 0.8), 5)
        const baseline = textBaseline(vAlign, py, fh, size, pad)
        drawTextWithHalo(page, value, alignedX(value, align, px + pad, fw - pad * 2, ftFont, size), baseline, size, ftFont)
        break
      }

      case "multiline": {
        if (!value) break
        const d      = TEXT_FORMAT_DEFAULTS.multiline
        const size0  = opts.fontSize  ?? d.fontSize
        const lh     = opts.lineHeight ?? d.lineHeight
        const pad    = opts.padding   ?? d.padding
        const align  = (opts.textAlign ?? d.textAlign) as "left" | "center" | "right"
        const ftFont = (opts.fontWeight ?? d.fontWeight) === "bold" ? boldFont : font
        const usableW = fw - pad * 2
        let size = size0
        let lines: string[] = []
        while (size >= 5) {
          lines = wrapText(value, usableW, ftFont, size)
          if (lines.length * size * lh <= fh - pad * 2) break
          size -= 0.5
        }
        const totalH = lines.length * size * lh
        let lineY: number
        if (vAlign === "bottom") {
          lineY = py + pad + totalH - size * 0.8 + PDF_FLATTEN_Y_OFFSET
        } else if (vAlign === "top") {
          lineY = py + fh - pad - size * 0.8 + PDF_FLATTEN_Y_OFFSET
        } else {
          lineY = py + (fh - totalH) / 2 + totalH - size * 0.8 + PDF_FLATTEN_Y_OFFSET
        }
        for (const line of lines) {
          if (lineY < py + pad) break
          drawTextWithHalo(page, line, alignedX(line, align, px + pad, usableW, ftFont, size), lineY, size, ftFont)
          lineY -= size * lh
        }
        break
      }

      case "date": {
        if (!value) break
        const d      = TEXT_FORMAT_DEFAULTS.date
        const pad    = opts.padding   ?? d.padding
        const align  = (opts.textAlign ?? d.textAlign) as "left" | "center" | "right"
        const ftFont = (opts.fontWeight ?? d.fontWeight) === "bold" ? boldFont : font
        const formatted = formatDate(value)
        const size = fitFontSize(formatted, fw - pad * 2, ftFont, Math.min(opts.fontSize ?? d.fontSize, fh * 0.8), 5)
        const baseline = textBaseline(vAlign, py, fh, size, pad)
        drawTextWithHalo(page, formatted, alignedX(formatted, align, px + pad, fw - pad * 2, ftFont, size), baseline, size, ftFont)
        break
      }

      case "signature":
      case "initials": {
        if (!value) break
        const base64 = value.replace(/^data:image\/\w+;base64,/, "")
        try {
          const img = await pdfDoc.embedPng(Buffer.from(base64, "base64"))
          // Modal canvas is fixed-size; scale to fit the field preserving aspect ratio,
          // then center within the field so the mark isn't distorted.
          const dims = img.scaleToFit(fw, fh)
          const imgX = px + (fw - dims.width)  / 2
          const imgY = py + (fh - dims.height) / 2
          page.drawImage(img, { x: imgX, y: imgY, width: dims.width, height: dims.height })
        } catch { /* skip if canvas was never drawn */ }
        break
      }

      case "checkbox": {
        if (value === "true") {
          const xPad = Math.min(fw, fh) * 0.18
          const checkColor = rgb(0.05, 0.45, 0.05)
          page.drawLine({ start: { x: px + xPad,      y: py + xPad      }, end: { x: px + fw - xPad, y: py + fh - xPad }, thickness: 1.8, color: checkColor })
          page.drawLine({ start: { x: px + fw - xPad, y: py + xPad      }, end: { x: px + xPad,      y: py + fh - xPad }, thickness: 1.8, color: checkColor })
        }
        break
      }

      case "yes_no": {
        if (!value) break
        const d      = TEXT_FORMAT_DEFAULTS.yes_no
        const pad    = opts.padding   ?? d.padding
        const align  = (opts.textAlign ?? d.textAlign) as "left" | "center" | "right"
        const ftFont = (opts.fontWeight ?? d.fontWeight) === "bold" ? boldFont : font
        const size = fitFontSize(value, fw - pad * 2, ftFont, Math.min(opts.fontSize ?? d.fontSize, fh * 0.8), 5)
        const baseline = textBaseline(vAlign, py, fh, size, pad)
        drawTextWithHalo(page, value, alignedX(value, align, px + pad, fw - pad * 2, ftFont, size), baseline, size, ftFont)
        break
      }

      case "rich_text": {
        if (!value) break
        const d      = TEXT_FORMAT_DEFAULTS.rich_text
        const size   = opts.fontSize   ?? d.fontSize
        const lh     = opts.lineHeight ?? d.lineHeight
        const align  = (opts.textAlign  ?? d.textAlign) as "left" | "center" | "right"
        const pad    = opts.padding    ?? d.padding
        const ftFont = (opts.fontWeight ?? d.fontWeight) === "bold" ? boldFont : font
        const usableW = fw - pad * 2
        const lines   = wrapRichText(value, usableW, ftFont, size)
        let lineY     = py + fh - pad - size * 0.8
        for (const line of lines) {
          if (lineY < py + pad) break
          if (line !== "") drawTextWithHalo(page, line, alignedX(line, align, px + pad, usableW, ftFont, size), lineY, size, ftFont)
          lineY -= size * lh
        }
        break
      }
    }
  }
}
