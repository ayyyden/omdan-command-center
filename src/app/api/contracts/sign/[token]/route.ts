import { NextRequest } from "next/server"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import nodemailer from "nodemailer"
import { createServiceClient } from "@/lib/supabase/service"

type FieldType = "text" | "multiline" | "date" | "signature" | "initials" | "checkbox" | "yes_no" | "rich_text"
type VAlign = "top" | "center" | "bottom"

interface FieldOptions {
  clearBackground?: boolean
  vAlign?: VAlign
  // rich_text formatting (values are PDF points / unitless multipliers)
  fontSize?: number
  lineHeight?: number
  fontWeight?: "normal" | "bold"
  textAlign?: "left" | "center" | "right"
  padding?: number
}

interface FieldValue {
  id: string
  page_number: number
  field_type: string
  label: string
  x: number      // 0-1 fraction of page width
  y: number      // 0-1 fraction of page height (from top)
  width: number
  height: number
  required: boolean
  value: string  // field value from customer
}

function defaultVAlign(ft: FieldType): VAlign {
  return ft === "signature" || ft === "initials" ? "bottom" : "center"
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    return await handleSign(req, params)
  } catch (err: any) {
    console.error("[sign] unhandled error:", err)
    return Response.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}

async function handleSign(
  req: NextRequest,
  params: Promise<{ token: string }>,
) {
  const { token } = await params
  const body = await req.json() as {
    signerName:   string
    fieldValues?: Record<string, string>  // fieldId → value
  }

  const { signerName, fieldValues = {} } = body

  if (!signerName) {
    return Response.json({ error: "Missing signer name" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch sent contract by token
  const { data: sent, error: sentErr } = await supabase
    .from("sent_contracts")
    .select(`
      id, user_id, customer_id, job_id,
      signing_token, signed_at,
      contract_template:contract_templates (
        id, name, storage_path, bucket, file_name
      )
    `)
    .eq("signing_token", token)
    .single()

  if (sentErr || !sent) {
    return Response.json({ error: "Contract not found" }, { status: 404 })
  }

  if (sent.signed_at) {
    return Response.json({ error: "Already signed" }, { status: 409 })
  }

  const template = sent.contract_template as unknown as {
    id: string
    name: string
    storage_path: string
    bucket: string
    file_name: string
  }

  // Load field definitions
  const { data: fieldDefs } = await supabase
    .from("contract_fields")
    .select("*")
    .eq("contract_template_id", template.id)
    .order("created_at")

  // Download original PDF
  const { data: blob, error: dlErr } = await supabase.storage
    .from(template.bucket)
    .download(template.storage_path)

  if (dlErr || !blob) {
    return Response.json({ error: "Could not retrieve contract file" }, { status: 500 })
  }

  const originalBytes = await blob.arrayBuffer()
  const pdfDoc = await PDFDocument.load(originalBytes)
  const pages = pdfDoc.getPages()

  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)

  // ── Flatten fields ──────────────────────────────────────────────────────────

  for (const def of (fieldDefs ?? [])) {
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

    const opts: FieldOptions = (def.options as FieldOptions | null) ?? {}
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

  // ── Audit footer on last page (tiny, below all content) ─────────────────────

  const lastPage = pages[pages.length - 1]
  const { width: lw } = lastPage.getSize()

  const now = new Date()
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

  // Single compact line at y=8 — well below any contract content
  lastPage.drawText(
    `Electronically signed by ${signerName} on ${dateStr}`,
    { x: 40, y: 8, size: 6.5, font: italicFont, color: rgb(0.55, 0.55, 0.55) },
  )

  // ── Upload signed PDF ────────────────────────────────────────────────────────

  const signedBytes  = await pdfDoc.save()
  const signedBuffer = Buffer.from(signedBytes)
  const signedPath   = `${sent.user_id}/signed_contracts/${sent.id}_signed.pdf`

  const { error: upErr } = await supabase.storage
    .from("files")
    .upload(signedPath, signedBuffer, { contentType: "application/pdf", upsert: true })

  if (upErr) {
    console.error("[sign] storage upload error:", upErr)
    return Response.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 500 })
  }

  const signedAt = now.toISOString()
  const safeName = template.file_name.replace(/\.pdf$/i, "")
  const signedFileName = `${safeName}_signed.pdf`

  // ── Update record ────────────────────────────────────────────────────────────

  await supabase
    .from("sent_contracts")
    .update({ status: "signed", signed_at: signedAt, signer_name: signerName, signed_pdf_path: signedPath })
    .eq("id", sent.id)

  // ── Attach files ─────────────────────────────────────────────────────────────

  await supabase.from("file_attachments").upsert(
    { user_id: sent.user_id, bucket: "files", storage_path: signedPath, file_name: signedFileName,
      category: "signed_contracts", entity_type: "customers", entity_id: sent.customer_id,
      size_bytes: signedBuffer.byteLength, mime_type: "application/pdf" },
    { onConflict: "bucket,storage_path,entity_type,entity_id" }
  )

  if (sent.job_id) {
    await supabase.from("file_attachments").upsert(
      { user_id: sent.user_id, bucket: "files", storage_path: signedPath, file_name: signedFileName,
        category: "signed_contracts", entity_type: "jobs", entity_id: sent.job_id,
        size_bytes: signedBuffer.byteLength, mime_type: "application/pdf" },
      { onConflict: "bucket,storage_path,entity_type,entity_id" }
    )
  }

  // ── Notify business ──────────────────────────────────────────────────────────

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email")
    .eq("user_id", sent.user_id)
    .single()

  await supabase.from("communication_logs").insert({
    user_id: sent.user_id, customer_id: sent.customer_id, job_id: sent.job_id ?? null,
    type: "custom", subject: `Contract signed: ${template.name}`,
    body: `${signerName} signed "${template.name}" on ${dateStr}.`, channel: "email",
  })

  if (company?.email && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
      await transporter.sendMail({
        from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to:      company.email,
        subject: `✅ Contract signed: ${template.name}`,
        text:    `${signerName} has signed the contract "${template.name}" on ${dateStr}.\n\nThe signed PDF is attached.`,
        attachments: [{ filename: signedFileName, content: signedBuffer, contentType: "application/pdf" }],
      })
    } catch { /* non-fatal */ }
  }

  return Response.json({ success: true })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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
