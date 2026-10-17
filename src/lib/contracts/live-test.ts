// Field editor "Live test": fills every field with realistic sample text and
// stamps it onto the real PDF with the exact same code the signing route
// uses (stamp-pdf.ts), so what you see is what a signed contract will look
// like — including where long answers shrink or get cut off.

import { PDFDocument } from "pdf-lib"
import { stampFieldsOntoPdf, ruledRows, type FieldDef, type StampReport } from "@/lib/contracts/stamp-pdf"

export type SampleLength = "short" | "typical" | "long"

interface FieldLike {
  id: string
  field_type: string
  label: string
  width: number
  height: number
  options: { lineSpacing?: number; fontSize?: number; padding?: number } | null
}

const PARAGRAPH =
  "Remove existing grass and haul away debris. Grade and compact the base, install 1,200 sq ft of premium artificial turf " +
  "with weed barrier and silica infill, and lay 450 sq ft of interlocking pavers on the side yard with a 6 inch concrete border. " +
  "Clean up the job site daily and do a final walk-through with the owner before the last payment. "

function byLabel(label: string, length: SampleLength): string | null {
  const l = label.toLowerCase()
  const pick = (short: string, typical: string, long: string) => (length === "short" ? short : length === "long" ? long : typical)
  if (/e-?mail/.test(l)) return pick("mg@gmail.com", "maria.gonzalez@gmail.com", "maria.guadalupe.gonzalez.hernandez@outlook.com")
  if (/phone|tel|cell|mobile|fax|home ?#|work ?#/.test(l)) return pick("760-555-0123", "(760) 555-0123", "(760) 555-0123 / (760) 555-0456")
  if (/city|zip|state/.test(l)) return pick("Indio", "Indio, CA 92201", "Rancho Cucamonga, CA 91730-1234")
  if (/address|street|property/.test(l)) return pick("1 Oak St", "82228 Lemon Grove Ave", "82228 Lemon Grove Avenue, Unit 14B, Indio, CA 92201")
  if (/name|owner|buyer|customer|print/.test(l)) return pick("Ana Ruiz", "Maria Gonzalez", "Maria Guadalupe Gonzalez-Hernandez")
  if (/price|amount|total|payment|deposit|down|\$|cost|balance/.test(l)) return pick("$500", "$12,450.00", "$1,245,450.00")
  if (/lic|registration|number|#/.test(l)) return pick("1148568", "1148568", "1148568-B-2026")
  if (/start|complet|date|d\.?o\.?b|birth/.test(l)) return pick("10/20", "October 20, 2026", "Monday, October 20, 2026")
  return null
}

/** Rough chars-per-row for a field of this width at its font size (Helvetica averages ~0.5 em). */
function charsPerRow(f: FieldLike, pageWidthPt: number): number {
  const size = f.options?.fontSize ?? 10
  const pad = f.options?.padding ?? 3
  return Math.max(8, Math.floor((f.width * pageWidthPt - pad * 2) / (size * 0.5)))
}

export function sampleValue(f: FieldLike, page: { widthPt: number; heightPt: number }, length: SampleLength = "typical"): string {
  switch (f.field_type) {
    case "date": {
      const d = new Date()
      return d.toISOString().slice(0, 10)
    }
    case "checkbox": return "true"
    case "yes_no":   return "Yes"
    case "signature":
    case "initials": return sampleSignature(f.field_type === "initials" ? "MG" : "Maria Gonzalez")
    case "multiline":
    case "rich_text": {
      const per = charsPerRow(f, page.widthPt)
      const rows = f.options?.lineSpacing ? ruledRows(f.height * page.heightPt, f.options.lineSpacing) : Math.max(2, Math.floor((f.height * page.heightPt) / 13))
      const target = length === "short" ? per * 0.8 : length === "long" ? per * rows * 1.6 : per * rows * 0.95
      let text = ""
      while (text.length < target) text += PARAGRAPH
      return trimToWord(text, Math.round(target))
    }
    default: {
      const labelled = byLabel(f.label, length)
      if (labelled) return labelled
      const per = charsPerRow(f, page.widthPt)
      if (length === "long") return trimToWord(GENERIC + " " + GENERIC, per * 2)
      // Narrow boxes (a #, a count) get a short value instead of a chopped word
      if (per < 12) return length === "short" ? "12" : "1042"
      return trimToWord(GENERIC, length === "short" ? Math.min(14, per) : Math.round(per * 0.7))
    }
  }
}

const GENERIC = "Artificial turf with pavers and a concrete border around the side yard"

/** Cut to at most n characters, always on a whole word (never "Artifici"). */
function trimToWord(text: string, n: number): string {
  if (text.length <= n) return text.trim()
  const cut = text.slice(0, n + 1)
  const sp = cut.lastIndexOf(" ")
  return (sp > 0 ? cut.slice(0, sp) : text.split(" ")[0]).replace(/[,;]+$/, "").trim()
}

const sigCache = new Map<string, string>()

/** A handwritten-looking sample signature (PNG data URL), like the signature pad produces. */
export function sampleSignature(name: string): string {
  if (sigCache.has(name)) return sigCache.get(name)!
  const c = document.createElement("canvas")
  c.width = 600; c.height = 200
  const ctx = c.getContext("2d")!
  ctx.fillStyle = "rgba(0,0,0,0)"
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = "#0f172a"
  ctx.font = "italic 96px 'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive"
  ctx.textBaseline = "middle"
  ctx.fillText(name, 20, 110, 560)
  const url = c.toDataURL("image/png")
  sigCache.set(name, url)
  return url
}

/** Stamps `values` onto the original PDF exactly like signing does; returns a blob URL + what overflowed. */
export async function stampTestPdf(originalBytes: ArrayBuffer, fields: FieldDef[], values: Record<string, string>): Promise<{ url: string; report: StampReport }> {
  const doc = await PDFDocument.load(originalBytes.slice(0))
  const report = await stampFieldsOntoPdf(doc, fields, values)
  const bytes = await doc.save()
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }))
  return { url, report }
}
