// Flattens any page-level /Rotate into the actual content stream, so every
// stored contract PDF always has rotation = 0 and getSize() reflects exactly
// what's visually displayed.
//
// Why this matters: contract_fields stores x/y/width/height as 0-1 fractions
// of the DISPLAYED page (what pdfjs shows in the Field Editor, which already
// respects /Rotate). The signing route stamps values back on with pdf-lib's
// page.getSize()/drawText(), which do NOT account for the page's /Rotate —
// they operate in the page's native, unrotated coordinate space. For a page
// with a non-zero rotation, that mismatch makes stamped text land rotated
// 90°/270° relative to the visible page (seen on "Project Warranty," the one
// source document authored landscape-in-a-portrait-box). Baking the rotation
// into the content once, at upload time, makes native == displayed for every
// document, so neither the Field Editor nor the stamping code need any
// rotation-aware math at all.
import { PDFDocument, degrees } from "pdf-lib"

export async function normalizePdfRotation(bytes: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(bytes)
  const needsFlatten = srcDoc.getPages().some((p) => p.getRotation().angle % 360 !== 0)
  if (!needsFlatten) return new Uint8Array(bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

  const outDoc = await PDFDocument.create()

  for (const srcPage of srcDoc.getPages()) {
    const rotation = ((srcPage.getRotation().angle % 360) + 360) % 360
    const { width: nativeW, height: nativeH } = srcPage.getSize()

    if (rotation === 0) {
      const [copied] = await outDoc.copyPages(srcDoc, [srcDoc.getPages().indexOf(srcPage)])
      outDoc.addPage(copied)
      continue
    }

    // Apparent (displayed) size swaps width/height for 90°/270°.
    const apparentW = rotation === 90 || rotation === 270 ? nativeH : nativeW
    const apparentH = rotation === 90 || rotation === 270 ? nativeW : nativeH

    const [embedded] = await outDoc.embedPages([srcPage])
    const newPage = outDoc.addPage([apparentW, apparentH])

    // Rotate the embedded content clockwise by `rotation` (matching the PDF
    // /Rotate semantics) and translate it back into the new page's positive
    // quadrant so it fills it exactly, upright.
    let x = 0
    let y = 0
    if (rotation === 90) { x = 0; y = nativeW }
    else if (rotation === 180) { x = nativeW; y = nativeH }
    else if (rotation === 270) { x = nativeH; y = 0 }

    newPage.drawPage(embedded, { x, y, rotate: degrees(-rotation) })
  }

  return outDoc.save()
}
