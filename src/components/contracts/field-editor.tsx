"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { usePdfPages } from "@/lib/use-pdf-pages"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Save, Trash2, AlignLeft, AlignCenter, AlignRight, ScanLine, FlaskConical, Undo2, AlignJustify } from "lucide-react"
import { detectLines, suggestFields, coverage } from "@/lib/contracts/detect-lines"
import { sampleValue, stampTestPdf, type SampleLength } from "@/lib/contracts/live-test"
import { ruledRows, DEFAULT_BASELINE_GAP, type StampReport } from "@/lib/contracts/stamp-pdf"

// ── Types ─────────────────────────────────────────────────────────────────────

export type FieldType =
  | "text" | "multiline" | "date"
  | "signature" | "initials"
  | "checkbox" | "yes_no"
  | "rich_text"

export type VAlign = "top" | "center" | "bottom"

export interface FieldOptions {
  clearBackground?: boolean   // default false
  vAlign?: VAlign             // default varies by type
  // rich_text formatting (stored in PDF points)
  fontSize?: number           // default 9 pt
  lineHeight?: number         // multiplier, default 1.4
  fontWeight?: "normal" | "bold"
  textAlign?: "left" | "center" | "right"
  padding?: number            // PDF points, default 4
  // Ruled-line mode (multiline): printed lines every lineSpacing pt — one row
  // of text sits on each (see stamp-pdf.ts)
  lineSpacing?: number
  baselineGap?: number
}

export type FillRole = "customer" | "staff"

export interface ContractField {
  id: string
  contract_template_id: string
  page_number: number
  field_type: FieldType
  label: string
  x: number
  y: number
  width: number
  height: number
  required: boolean
  options: FieldOptions | null
  fill_role: FillRole
}

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text:       "Text",
  multiline:  "Multiline",
  date:       "Date",
  signature:  "Signature",
  initials:   "Initials",
  checkbox:   "Checkbox",
  yes_no:     "Yes / No",
  rich_text:  "Rich Text",
}

const FIELD_DEFAULTS: Record<FieldType, { width: number; height: number }> = {
  text:       { width: 0.30, height: 0.040 },
  multiline:  { width: 0.40, height: 0.080 },
  date:       { width: 0.18, height: 0.040 },
  signature:  { width: 0.35, height: 0.080 },
  initials:   { width: 0.12, height: 0.060 },
  checkbox:   { width: 0.04, height: 0.040 },
  yes_no:     { width: 0.15, height: 0.040 },
  rich_text:  { width: 0.75, height: 0.180 },
}

const FIELD_COLORS: Record<FieldType, string> = {
  text:       "border-blue-400 bg-blue-50/60",
  multiline:  "border-blue-500 bg-blue-50/60",
  date:       "border-cyan-400 bg-cyan-50/60",
  signature:  "border-purple-500 bg-purple-50/60",
  initials:   "border-violet-400 bg-violet-50/60",
  checkbox:   "border-green-500 bg-green-50/60",
  yes_no:     "border-orange-400 bg-orange-50/60",
  rich_text:  "border-emerald-500 bg-emerald-50/60",
}

function defaultVAlign(ft: FieldType): VAlign {
  // text/date fields are almost always placed over a printed ruled line —
  // text should sit just above it, like handwriting, not float centered in
  // whatever height the box happens to be.
  if (ft === "signature" || ft === "text" || ft === "date") return "bottom"
  if (ft === "rich_text") return "top"
  return "center"
}

// Text-based field types that get formatting controls
const TEXT_FIELD_TYPES = new Set<FieldType>(["text", "multiline", "date", "yes_no", "rich_text"])

// Default formatting per type — stored in PDF points / unitless multipliers.
// These are also the fallback values when a saved field has no options set.
export const TEXT_FORMAT_DEFAULTS: Record<string, {
  fontSize: number; lineHeight: number
  fontWeight: "normal" | "bold"; textAlign: "left" | "center" | "right"; padding: number
}> = {
  text:       { fontSize: 10, lineHeight: 1.3, fontWeight: "bold",   textAlign: "left",   padding: 2 },
  multiline:  { fontSize: 10, lineHeight: 1.3, fontWeight: "normal", textAlign: "left",   padding: 3 },
  date:       { fontSize: 10, lineHeight: 1.3, fontWeight: "bold",   textAlign: "left",   padding: 2 },
  yes_no:     { fontSize: 11, lineHeight: 1.3, fontWeight: "bold",   textAlign: "center", padding: 2 },
  rich_text:  { fontSize:  9, lineHeight: 1.4, fontWeight: "normal", textAlign: "left",   padding: 4 },
}

function defaultOptions(ft: FieldType): FieldOptions {
  const base: FieldOptions = { clearBackground: false, vAlign: defaultVAlign(ft) }
  const d = TEXT_FORMAT_DEFAULTS[ft]
  if (!d) return base
  return { ...base, fontSize: d.fontSize, lineHeight: d.lineHeight, fontWeight: d.fontWeight, textAlign: d.textAlign, padding: d.padding }
}

function getOpts(f: ContractField): FieldOptions {
  return (f.options ?? {}) as FieldOptions
}

// ── Live field preview ───────────────────────────────────────────────────────
// Renders real sample text at the real font size/alignment/padding a value
// would get when stamped by /api/contracts/sign/[token] — so placing a field
// means seeing exactly what will print there, not eyeballing an empty box
// against the line underneath it.

const ALIGN_ITEMS: Record<VAlign, React.CSSProperties["alignItems"]> = {
  top: "flex-start", center: "center", bottom: "flex-end",
}
const JUSTIFY: Record<"left" | "center" | "right", React.CSSProperties["justifyContent"]> = {
  left: "flex-start", center: "center", right: "flex-end",
}

function sampleTextFor(ft: FieldType): string {
  switch (ft) {
    case "date":      return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    case "yes_no":     return "Yes"
    case "multiline":
    case "rich_text":  return "Sample text will wrap like this across multiple lines inside the box."
    default:           return "Sample Text"
  }
}

function FieldPreviewContent({ field, pdfScale }: { field: ContractField; pdfScale: number }) {
  const ft = field.field_type

  if (ft === "signature" || ft === "initials") {
    return (
      <div className="w-full h-full flex items-center justify-center text-slate-400 text-[11px] italic select-none pointer-events-none">
        {ft === "initials" ? "Initials" : "Signature"}
      </div>
    )
  }

  if (ft === "checkbox") {
    return (
      <div className="w-full h-full flex items-center justify-center select-none pointer-events-none">
        <div className="w-1/2 h-1/2 min-w-3 min-h-3 border-2 border-green-700/70 rounded-sm flex items-center justify-center text-green-700/80 text-[10px] font-bold leading-none">
          ✓
        </div>
      </div>
    )
  }

  const opts = getOpts(field)
  const d = TEXT_FORMAT_DEFAULTS[ft] ?? TEXT_FORMAT_DEFAULTS.text
  const fontSize   = (opts.fontSize ?? d.fontSize) * pdfScale
  const padding    = (opts.padding  ?? d.padding)  * pdfScale
  const lineHeight = opts.lineHeight ?? d.lineHeight
  const fontWeight = opts.fontWeight ?? d.fontWeight
  const textAlign  = (opts.textAlign ?? d.textAlign) as "left" | "center" | "right"
  const vAlign     = opts.vAlign ?? defaultVAlign(ft)
  const multiline  = ft === "multiline" || ft === "rich_text"

  // Ruled-line mode: show one sample row resting on each printed line
  if (ft === "multiline" && opts.lineSpacing) {
    const spacing = opts.lineSpacing * pdfScale
    const gap = (opts.baselineGap ?? DEFAULT_BASELINE_GAP) * pdfScale
    const size = Math.min(fontSize, spacing - gap - pdfScale)
    // Rows past the box's last printed line fall outside it and are clipped
    return (
      <div className="relative w-full h-full select-none pointer-events-none overflow-hidden">
        {Array.from({ length: 64 }).map((_, k) => {
          const bottom = (k + 1) * spacing - gap
          return (
            <span
              key={k}
              className="absolute whitespace-nowrap overflow-hidden"
              style={{
                left: padding, right: padding, top: bottom - size * 0.8, fontSize: `${size}px`, lineHeight: 1,
                fontWeight, textAlign, fontFamily: "Helvetica, Arial, sans-serif", color: "rgba(15,23,42,0.6)",
              }}
            >
              Sample row {k + 1} sits on its printed line
            </span>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className="w-full h-full flex select-none pointer-events-none"
      style={{ alignItems: ALIGN_ITEMS[vAlign], justifyContent: JUSTIFY[textAlign], padding: `${padding}px`, boxSizing: "border-box" }}
    >
      <span
        style={{
          fontSize:   `${fontSize}px`,
          lineHeight,
          fontWeight,
          textAlign,
          fontFamily: "Helvetica, Arial, sans-serif",
          color:      "rgba(15,23,42,0.6)",
          whiteSpace: multiline ? "normal" : "nowrap",
          overflow:   "hidden",
          width:      "100%",
        }}
      >
        {sampleTextFor(ft)}
      </span>
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  contractTemplateId: string
  contractName: string
  pdfUrl: string | null
}

// ── Main component ────────────────────────────────────────────────────────────

export function FieldEditor({ contractTemplateId, contractName, pdfUrl }: Props) {
  const { toast } = useToast()
  const supabase = createClient()

  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(800)

  const { pages, loading: pdfLoading, error: pdfError } = usePdfPages(pdfUrl, containerWidth)

  const [fields, setFields] = useState<ContractField[]>([])
  const [loadingFields, setLoadingFields] = useState(true)
  const [saving, setSaving] = useState(false)

  const [addingType, setAddingType] = useState<FieldType | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // ── Find blank lines / Live test state ────────────────────────────────────
  const [finding, setFinding] = useState(false)
  const [lastAdded, setLastAdded] = useState<string[]>([])
  const [testMode, setTestMode] = useState(false)
  const [testValues, setTestValues] = useState<Record<string, string>>({})
  const [testUrl, setTestUrl] = useState<string | null>(null)
  const [report, setReport] = useState<StampReport>({})
  const [stamping, setStamping] = useState(false)
  const originalBytes = useRef<ArrayBuffer | null>(null)
  const test = usePdfPages(testMode ? testUrl : null, containerWidth, { keepPrevious: true })

  const pageDims = useCallback((n: number) => {
    const pg = pages[n - 1] ?? pages[0]
    return { widthPt: pg?.pdfWidth ?? 612, heightPt: pg?.pdfHeight ?? 792 }
  }, [pages])

  const testValueFor = useCallback((f: ContractField) => testValues[f.id] ?? sampleValue(f, pageDims(f.page_number)), [testValues, pageDims])

  // Re-stamp the real PDF with the test values whenever a field or value changes
  useEffect(() => {
    if (!testMode || !pdfUrl || !pages.length) return
    let cancelled = false
    const t = setTimeout(async () => {
      setStamping(true)
      try {
        if (!originalBytes.current) originalBytes.current = await fetch(pdfUrl).then((r) => r.arrayBuffer())
        const values = Object.fromEntries(fields.map((f) => [f.id, testValueFor(f)]))
        const res = await stampTestPdf(originalBytes.current!, fields, values)
        if (cancelled) { URL.revokeObjectURL(res.url); return }
        setTestUrl((old) => { if (old) setTimeout(() => URL.revokeObjectURL(old), 5000); return res.url })
        setReport(res.report)
      } catch (err) {
        toast({ title: "Live test failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
      } finally {
        if (!cancelled) setStamping(false)
      }
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [testMode, pdfUrl, pages.length, fields, testValueFor]) // eslint-disable-line react-hooks/exhaustive-deps

  function findBlankLines() {
    if (!pages.length) return
    setFinding(true)
    // Let the spinner paint before the (fast, synchronous) pixel scan
    setTimeout(() => {
      const added: ContractField[] = []
      for (const pg of pages) {
        const dims = { pdfWidth: pg.pdfWidth, pdfHeight: pg.pdfHeight }
        const suggestions = suggestFields(pg.canvas, detectLines(pg.canvas, dims), dims)
        const existing = [...fields, ...added].filter((f) => f.page_number === pg.pageNumber)
        for (const s of suggestions) {
          if (existing.some((f) => coverage(s, f) > 0.3 || coverage(f, s) > 0.3)) continue
          const type: FieldType = s.kind === "multiline" ? "multiline" : "text"
          added.push({
            id: crypto.randomUUID(),
            contract_template_id: contractTemplateId,
            page_number: pg.pageNumber,
            field_type: type,
            label: s.kind === "multiline" ? `Lines (${s.rows})` : "Text",
            x: s.x, y: s.y, width: s.width, height: s.height,
            required: false,
            options: s.kind === "multiline" ? { ...defaultOptions("multiline"), lineSpacing: s.lineSpacing } : defaultOptions("text"),
            fill_role: "customer",
          })
        }
      }
      setFields((prev) => [...prev, ...added])
      setLastAdded(added.map((f) => f.id))
      setFinding(false)
      toast({
        title: added.length ? `Added ${added.length} field${added.length === 1 ? "" : "s"} on blank lines` : "No new blank lines found",
        description: added.length ? "Check them, rename or change types (signature, date…), then Save Fields." : "Every line already has a field.",
      })
    }, 30)
  }

  function undoFind() {
    const ids = new Set(lastAdded)
    setFields((prev) => prev.filter((f) => !ids.has(f.id)))
    setLastAdded([])
    if (selectedId && ids.has(selectedId)) setSelectedId(null)
  }

  /** Snap the selected field onto the printed line(s) under it. */
  function fitToLines(f: ContractField) {
    const pg = pages[f.page_number - 1]
    if (!pg) return
    const dims = { pdfWidth: pg.pdfWidth, pdfHeight: pg.pdfHeight }
    const ph = pg.pdfHeight
    const lines = detectLines(pg.canvas, dims).filter((l) => {
      const ov = Math.max(0, Math.min(l.x1, f.x + f.width) - Math.max(l.x0, f.x))
      return ov >= 0.5 * f.width && l.y >= f.y - 4 / ph && l.y <= f.y + f.height + 8 / ph
    })
    if (!lines.length) {
      toast({ title: "No printed line under this field", description: "Move the box over the line(s) first, then try again." })
      return
    }
    const multi = f.field_type === "multiline" && lines.length >= 2
    if (multi) {
      const spacingPt = ((lines[lines.length - 1].y - lines[0].y) * ph) / (lines.length - 1)
      const top = lines[0].y - spacingPt / ph
      updateField(f.id, { y: Math.max(0, top), height: (lines.length * spacingPt + 1.5) / ph })
      updateOpts(f.id, { lineSpacing: Math.round(spacingPt * 10) / 10 })
      toast({ title: `Fitted to ${lines.length} printed lines`, description: `${spacingPt.toFixed(1)} pt apart. One row of text will sit on each.` })
    } else {
      const line = lines[lines.length - 1]
      updateField(f.id, { y: Math.max(0, line.y - 13 / ph), height: 18 / ph })
      if (f.field_type === "text" || f.field_type === "date") updateOpts(f.id, { vAlign: "bottom" })
      toast({ title: "Snapped onto the line" })
    }
  }

  function setTestLength(f: ContractField, length: SampleLength) {
    setTestValues((v) => ({ ...v, [f.id]: sampleValue(f, pageDims(f.page_number), length) }))
  }

  const dragRef = useRef<{
    id: string
    mode: "move" | "resize"
    startX: number
    startY: number
    origField: ContractField
    pageWidth: number
    pageHeight: number
  } | null>(null)

  // ── Measure container ─────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(Math.floor(entry.contentRect.width))
    })
    ro.observe(el)
    setContainerWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  // ── Load fields ───────────────────────────────────────────────────────────

  useEffect(() => {
    setLoadingFields(true)
    supabase
      .from("contract_fields")
      .select("*")
      .eq("contract_template_id", contractTemplateId)
      .order("created_at")
      .then(({ data }) => {
        setFields((data ?? []) as ContractField[])
        setLoadingFields(false)
      })
  }, [contractTemplateId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Page click → place field ──────────────────────────────────────────────

  function handlePageClick(
    e: React.MouseEvent<HTMLDivElement>,
    pageNumber: number,
    pageWidth: number,
    pageHeight: number,
  ) {
    if (!addingType) return
    const rect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    const defaults = FIELD_DEFAULTS[addingType]
    const newField: ContractField = {
      id:                   crypto.randomUUID(),
      contract_template_id: contractTemplateId,
      page_number:          pageNumber,
      field_type:           addingType,
      label:                FIELD_TYPE_LABELS[addingType],
      x:                    Math.max(0, Math.min(1 - defaults.width,  px / pageWidth)),
      y:                    Math.max(0, Math.min(1 - defaults.height, py / pageHeight)),
      width:                defaults.width,
      height:               defaults.height,
      required:             false,
      options:              defaultOptions(addingType),
      fill_role:            "customer",
    }
    setFields((prev) => [...prev, newField])
    setAddingType(null)
    setSelectedId(newField.id)
  }

  // ── Drag / resize ─────────────────────────────────────────────────────────

  const startDrag = useCallback((
    e: React.MouseEvent,
    id: string,
    mode: "move" | "resize",
    pageWidth: number,
    pageHeight: number,
  ) => {
    e.stopPropagation()
    const field = fields.find((f) => f.id === id)
    if (!field) return
    dragRef.current = {
      id, mode,
      startX: e.clientX,
      startY: e.clientY,
      origField: { ...field },
      pageWidth,
      pageHeight,
    }
    setSelectedId(id)
  }, [fields])

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const d = dragRef.current
      if (!d) return
      const dx = (e.clientX - d.startX) / d.pageWidth
      const dy = (e.clientY - d.startY) / d.pageHeight
      setFields((prev) => prev.map((f) => {
        if (f.id !== d.id) return f
        if (d.mode === "move") {
          return {
            ...f,
            x: Math.max(0, Math.min(1 - f.width,  d.origField.x + dx)),
            y: Math.max(0, Math.min(1 - f.height, d.origField.y + dy)),
          }
        }
        const newW = Math.max(0.04, Math.min(1 - d.origField.x, d.origField.width  + dx))
        const newH = Math.max(0.02, Math.min(1 - d.origField.y, d.origField.height + dy))
        return { ...f, width: newW, height: newH }
      }))
    }
    function onUp() { dragRef.current = null }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
    return () => {
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
  }, [])

  // ── Field updates ─────────────────────────────────────────────────────────

  function updateField(id: string, patch: Partial<ContractField>) {
    setFields((prev) => prev.map((f) => f.id === id ? { ...f, ...patch } : f))
  }

  function updateOpts(id: string, patch: Partial<FieldOptions>) {
    setFields((prev) => prev.map((f) =>
      f.id === id ? { ...f, options: { ...(f.options ?? {}), ...patch } } : f
    ))
  }

  function clampFrac(v: number): number {
    return Math.min(1, Math.max(0, Math.round(v * 10000) / 10000))
  }

  function updateCoord(id: string, key: "x" | "y" | "width" | "height", pct: string) {
    const v = clampFrac(parseFloat(pct) / 100)
    if (!isNaN(v)) updateField(id, { [key]: v })
  }

  function deleteField(id: string) {
    setFields((prev) => prev.filter((f) => f.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true)

    await supabase
      .from("contract_fields")
      .delete()
      .eq("contract_template_id", contractTemplateId)

    if (fields.length > 0) {
      const { error } = await supabase.from("contract_fields").insert(
        fields.map((f) => ({
          id:                   f.id,
          contract_template_id: f.contract_template_id,
          page_number:          f.page_number,
          field_type:           f.field_type,
          label:                f.label,
          x:                    f.x,
          y:                    f.y,
          width:                f.width,
          height:               f.height,
          required:             f.required,
          options:              f.options,
          fill_role:            f.fill_role,
        }))
      )
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" })
        setSaving(false)
        return
      }
    }

    setSaving(false)
    toast({ title: "Fields saved" })
  }

  const selectedField = fields.find((f) => f.id === selectedId) ?? null

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex gap-4 h-full min-h-0">

      {/* ── Left sidebar ──────────────────────────────────────────────────── */}
      <div className="w-56 shrink-0 flex flex-col gap-3 overflow-y-auto">
        {/* ── Tools ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" className="justify-start gap-2" onClick={findBlankLines} disabled={finding || !pages.length || testMode}>
            {finding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
            Find blank lines
          </Button>
          {lastAdded.length > 0 && (
            <button type="button" onClick={undoFind} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-1">
              <Undo2 className="w-3 h-3" /> Undo: remove the {lastAdded.length} added
            </button>
          )}
          <Button
            size="sm"
            variant={testMode ? "default" : "outline"}
            className="justify-start gap-2"
            onClick={() => { setTestMode((v) => !v); setAddingType(null) }}
            disabled={!pages.length}
          >
            {stamping && testMode ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
            {testMode ? "Live test: on" : "Live test"}
          </Button>
          {testMode && (() => {
            const problems = Object.entries(report).filter(([, r]) => r.cutOff || r.shrunkTo)
            return (
              <p className="text-[11px] text-muted-foreground px-1 leading-snug">
                Filled with sample text and stamped exactly like a signed contract.
                {problems.length > 0
                  ? <span className="block mt-1 text-destructive">{problems.length} field{problems.length === 1 ? "" : "s"} too small for the text (outlined red).</span>
                  : <span className="block mt-1 text-success">Everything fits.</span>}
              </p>
            )
          })()}
        </div>

        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Field</p>
        <div className="flex flex-col gap-1">
          {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map((ft) => (
            <button
              key={ft}
              type="button"
              onClick={() => { setAddingType(addingType === ft ? null : ft); setSelectedId(null) }}
              className={`text-left text-sm px-3 py-1.5 rounded-md border transition-colors ${
                addingType === ft
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {FIELD_TYPE_LABELS[ft]}
            </button>
          ))}
        </div>

        {addingType && (
          <p className="text-xs text-muted-foreground bg-muted/60 rounded px-2 py-1.5">
            Click anywhere on the PDF to place a <strong>{FIELD_TYPE_LABELS[addingType]}</strong> field.
          </p>
        )}

        {/* ── Selected field properties ─────────────────────────────────── */}
        {selectedField && (() => {
          const opts = getOpts(selectedField)
          const isRichText  = selectedField.field_type === "rich_text"
          const isTextField = TEXT_FIELD_TYPES.has(selectedField.field_type)
          return (
            <div className="border rounded-md p-3 space-y-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Properties</p>

              {/* Label */}
              <div className="space-y-1">
                <Label className="text-xs">Label</Label>
                <Input
                  value={selectedField.label}
                  onChange={(e) => updateField(selectedField.id, { label: e.target.value })}
                  className="h-7 text-xs"
                />
              </div>

              {/* Required */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="req-check"
                  checked={selectedField.required}
                  onChange={(e) => updateField(selectedField.id, { required: e.target.checked })}
                />
                <Label htmlFor="req-check" className="text-xs cursor-pointer">Required</Label>
              </div>

              {/* Filled by */}
              <div className="space-y-1">
                <Label className="text-xs">Filled by</Label>
                <div className="flex gap-1">
                  {([
                    { value: "customer", label: "Customer" },
                    { value: "staff",    label: "Staff" },
                  ] as const).map(({ value, label: l }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => updateField(selectedField.id, { fill_role: value })}
                      className={`flex-1 h-7 text-xs rounded border transition-colors ${
                        selectedField.fill_role === value
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-border hover:bg-muted"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {selectedField.fill_role === "staff" && (
                  <p className="text-[10px] text-muted-foreground">
                    Filled by staff before sending/signing — the customer never sees this field.
                  </p>
                )}
              </div>

              {/* Position */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mb-1">Position (%)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["x", "y"] as const).map((key) => (
                    <div key={key} className="space-y-0.5">
                      <Label className="text-[10px]">{key.toUpperCase()}</Label>
                      <Input
                        type="number" step="0.1" min="0" max="100"
                        value={(selectedField[key] * 100).toFixed(1)}
                        onChange={(e) => updateCoord(selectedField.id, key, e.target.value)}
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div>
                <p className="text-[10px] font-medium text-muted-foreground mb-1">Size (%)</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["width", "height"] as const).map((key) => (
                    <div key={key} className="space-y-0.5">
                      <Label className="text-[10px]">{key === "width" ? "W" : "H"}</Label>
                      <Input
                        type="number" step="0.1" min="0.5" max="100"
                        value={(selectedField[key] * 100).toFixed(1)}
                        onChange={(e) => updateCoord(selectedField.id, key, e.target.value)}
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Text formatting controls (all text-based fields) ─────── */}
              {isTextField && (() => {
                const fd = TEXT_FORMAT_DEFAULTS[selectedField.field_type] ?? TEXT_FORMAT_DEFAULTS.text
                return (
                <div className="space-y-2 pt-1 border-t">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Formatting</p>

                  {/* Font size + line height */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="space-y-0.5">
                      <Label className="text-[10px]">Size (pt)</Label>
                      <Input
                        type="number" step="0.5" min="6" max="24"
                        value={opts.fontSize ?? fd.fontSize}
                        onChange={(e) => updateOpts(selectedField.id, { fontSize: parseFloat(e.target.value) || fd.fontSize })}
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <Label className="text-[10px]">Line ht.</Label>
                      <Input
                        type="number" step="0.05" min="1" max="3"
                        value={opts.lineHeight ?? fd.lineHeight}
                        onChange={(e) => updateOpts(selectedField.id, { lineHeight: parseFloat(e.target.value) || fd.lineHeight })}
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                  </div>

                  {/* Font weight */}
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Weight</Label>
                    <div className="flex gap-1">
                      {(["normal", "bold"] as const).map((w) => (
                        <button
                          key={w}
                          type="button"
                          onClick={() => updateOpts(selectedField.id, { fontWeight: w })}
                          className={`flex-1 h-6 text-xs rounded border transition-colors ${
                            (opts.fontWeight ?? fd.fontWeight) === w
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                          style={{ fontWeight: w }}
                        >
                          {w === "bold" ? "Bold" : "Normal"}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text alignment */}
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Align</Label>
                    <div className="flex gap-1">
                      {([
                        { value: "left",   Icon: AlignLeft   },
                        { value: "center", Icon: AlignCenter },
                        { value: "right",  Icon: AlignRight  },
                      ] as const).map(({ value, Icon }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => updateOpts(selectedField.id, { textAlign: value })}
                          className={`flex-1 h-6 flex items-center justify-center rounded border transition-colors ${
                            (opts.textAlign ?? fd.textAlign) === value
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:bg-muted"
                          }`}
                        >
                          <Icon className="w-3 h-3" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Padding */}
                  <div className="space-y-0.5">
                    <Label className="text-[10px]">Padding (pt)</Label>
                    <Input
                      type="number" step="1" min="0" max="20"
                      value={opts.padding ?? fd.padding}
                      onChange={(e) => updateOpts(selectedField.id, { padding: parseFloat(e.target.value) || 0 })}
                      className="h-6 text-xs px-1.5"
                    />
                  </div>
                </div>
                )
              })()}

              {/* ── Printed lines (multiline) / snap to line (text, date) ── */}
              {selectedField.field_type === "multiline" && (() => {
                const pdfH = pageDims(selectedField.page_number).heightPt
                const rows = opts.lineSpacing ? ruledRows(selectedField.height * pdfH, opts.lineSpacing) : null
                return (
                  <div className="space-y-1.5 pt-1 border-t">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Printed lines</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Spacing (pt)</Label>
                        <Input
                          type="number" step="0.1" min="8" max="60" placeholder="off"
                          value={opts.lineSpacing ?? ""}
                          onChange={(e) => updateOpts(selectedField.id, { lineSpacing: e.target.value ? parseFloat(e.target.value) : undefined })}
                          className="h-6 text-xs px-1.5"
                        />
                      </div>
                      <div className="space-y-0.5">
                        <Label className="text-[10px]">Above line (pt)</Label>
                        <Input
                          type="number" step="0.5" min="0" max="10"
                          value={opts.baselineGap ?? DEFAULT_BASELINE_GAP}
                          onChange={(e) => updateOpts(selectedField.id, { baselineGap: parseFloat(e.target.value) || 0 })}
                          className="h-6 text-xs px-1.5"
                          disabled={!opts.lineSpacing}
                        />
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {rows ? `${rows} row${rows === 1 ? "" : "s"}, one on each printed line.` : "Off: text wraps freely inside the box."}
                    </p>
                    <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5" onClick={() => fitToLines(selectedField)}>
                      <AlignJustify className="w-3 h-3" /> Fit to the lines under it
                    </Button>
                  </div>
                )
              })()}
              {(selectedField.field_type === "text" || selectedField.field_type === "date") && (
                <Button size="sm" variant="outline" className="w-full h-7 text-xs gap-1.5" onClick={() => fitToLines(selectedField)}>
                  <AlignJustify className="w-3 h-3" /> Snap onto the line
                </Button>
              )}

              {/* ── Live test text for this field ───────────────────────── */}
              {testMode && !["signature", "initials", "checkbox"].includes(selectedField.field_type) && (
                <div className="space-y-1.5 pt-1 border-t">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Test text</p>
                  <Textarea
                    rows={3}
                    value={testValueFor(selectedField)}
                    onChange={(e) => setTestValues((v) => ({ ...v, [selectedField.id]: e.target.value }))}
                    className="text-xs"
                  />
                  <div className="flex gap-1">
                    {(["short", "typical", "long"] as const).map((len) => (
                      <button key={len} type="button" onClick={() => setTestLength(selectedField, len)}
                        className="flex-1 h-6 text-[11px] rounded border bg-background hover:bg-muted capitalize">{len}</button>
                    ))}
                  </div>
                  {report[selectedField.id]?.cutOff && <p className="text-[11px] text-destructive">Too much text: the end gets cut off. Make the box bigger or the font smaller.</p>}
                  {!report[selectedField.id]?.cutOff && report[selectedField.id]?.shrunkTo && (
                    <p className="text-[11px] text-warning">Fits only by shrinking the text to {report[selectedField.id]!.shrunkTo} pt.</p>
                  )}
                  {report[selectedField.id]?.rows && (
                    <p className="text-[11px] text-muted-foreground">Uses {report[selectedField.id]!.rowsUsed} of {report[selectedField.id]!.rows} lines.</p>
                  )}
                </div>
              )}

              {/* ── Standard controls (non-rich_text) ───────────────────── */}
              {!isRichText && (
                <div className="space-y-1">
                  <Label className="text-xs">Vertical align</Label>
                  <select
                    value={opts.vAlign ?? defaultVAlign(selectedField.field_type)}
                    onChange={(e) => updateOpts(selectedField.id, { vAlign: e.target.value as VAlign })}
                    className="w-full text-xs border rounded-md h-7 px-2 bg-background"
                  >
                    <option value="top">Top</option>
                    <option value="center">Center</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </div>
              )}

              {/* Clear background */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="clear-bg"
                  checked={opts.clearBackground === true}
                  onChange={(e) => updateOpts(selectedField.id, { clearBackground: e.target.checked })}
                />
                <Label htmlFor="clear-bg" className="text-xs cursor-pointer">Clear background</Label>
              </div>

              <div className="text-xs text-muted-foreground/60 space-y-0.5 pt-1 border-t">
                <p>Type: {FIELD_TYPE_LABELS[selectedField.field_type]}</p>
                <p>Page: {selectedField.page_number}</p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive w-full gap-1.5"
                onClick={() => deleteField(selectedField.id)}
              >
                <Trash2 className="w-3 h-3" /> Delete Field
              </Button>
            </div>
          )
        })()}

        <div className="mt-auto pt-3 border-t">
          <Button
            size="sm"
            className="w-full gap-1.5"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Save Fields
          </Button>
          <p className="text-xs text-muted-foreground/60 mt-1.5 text-center">
            {fields.length} field{fields.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* ── PDF canvas area ────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto min-h-0 bg-muted/30 rounded-lg"
      >
        {pdfLoading || loadingFields ? (
          <div className="flex items-center justify-center h-48 gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading PDF…
          </div>
        ) : pdfError ? (
          <div className="flex items-center justify-center h-48 text-destructive text-sm">
            {pdfError}
          </div>
        ) : (
          <div className="space-y-4 p-4">
            {(testMode && test.pages.length ? test.pages : pages).map((pg) => {
              const pageFields = fields.filter((f) => f.page_number === pg.pageNumber)
              const pdfScale = pg.width / pg.pdfWidth
              return (
                <div key={pg.pageNumber}>
                  <p className="text-xs text-muted-foreground mb-1">Page {pg.pageNumber}</p>
                  <div
                    className="relative inline-block shadow-md"
                    style={{
                      width:  pg.width,
                      height: pg.height,
                      cursor: addingType ? "crosshair" : "default",
                    }}
                    onClick={(e) => handlePageClick(e, pg.pageNumber, pg.width, pg.height)}
                  >
                    <CanvasDisplay canvas={pg.canvas} cssWidth={pg.width} cssHeight={pg.height} />

                    {pageFields.map((f) => {
                      const fx = f.x * pg.width
                      const fy = f.y * pg.height
                      const fw = f.width  * pg.width
                      const fh = f.height * pg.height
                      const isSelected = f.id === selectedId
                      const problem = testMode ? report[f.id] : undefined
                      const overflow = !!problem && (problem.cutOff || !!problem.shrunkTo)

                      if (testMode) {
                        // Live test: the page underneath is the real stamped PDF —
                        // just a thin outline to select/move, red where text doesn't fit
                        return (
                          <div key={f.id} className="absolute" style={{ left: fx, top: fy, width: fw, height: fh }}>
                            {overflow && (
                              <div className="absolute -top-4 left-0 text-[9px] font-medium px-1 rounded-sm bg-destructive text-destructive-foreground whitespace-nowrap pointer-events-none">
                                {problem!.cutOff ? "Text cut off" : `Shrinks to ${problem!.shrunkTo} pt`}
                              </div>
                            )}
                            <div
                              className={`w-full h-full rounded-sm cursor-move border ${overflow ? "border-2 border-destructive" : isSelected ? "border-primary border-dashed" : "border-transparent hover:border-primary/40 hover:border-dashed"}`}
                              onMouseDown={(e) => startDrag(e, f.id, "move", pg.width, pg.height)}
                              onClick={(e) => { e.stopPropagation(); setSelectedId(f.id) }}
                            >
                              {isSelected && (
                                <div
                                  className="absolute bottom-0 right-0 w-3 h-3 bg-primary/80 cursor-se-resize"
                                  onMouseDown={(e) => { e.stopPropagation(); startDrag(e, f.id, "resize", pg.width, pg.height) }}
                                />
                              )}
                            </div>
                          </div>
                        )
                      }

                      return (
                        <div key={f.id} className="absolute" style={{ left: fx, top: fy, width: fw, height: fh }}>
                          {/* Label floats above the box so it never competes with the
                              live text preview inside it — the box itself now shows
                              exactly what will be stamped, not just an empty rectangle. */}
                          <div className="absolute -top-4 left-0 text-[9px] font-medium px-1 rounded-sm bg-background/95 border border-border/60 text-foreground/70 whitespace-nowrap pointer-events-none select-none">
                            {f.required ? "* " : ""}{f.label}
                          </div>
                          <div
                            className={`w-full h-full border-2 rounded-sm cursor-move overflow-hidden ${FIELD_COLORS[f.field_type]} ${isSelected ? "ring-2 ring-primary ring-offset-0" : ""}`}
                            onMouseDown={(e) => startDrag(e, f.id, "move", pg.width, pg.height)}
                            onClick={(e) => { e.stopPropagation(); setSelectedId(f.id); setAddingType(null) }}
                          >
                            <FieldPreviewContent field={f} pdfScale={pdfScale} />
                            <div
                              className="absolute bottom-0 right-0 w-3 h-3 bg-primary/80 cursor-se-resize"
                              onMouseDown={(e) => { e.stopPropagation(); startDrag(e, f.id, "resize", pg.width, pg.height) }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function CanvasDisplay({ canvas, cssWidth, cssHeight }: { canvas: HTMLCanvasElement; cssWidth: number; cssHeight: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !canvas) return
    el.innerHTML = ""
    // Explicit px so the canvas buffer (which may be DPR× larger) is displayed
    // at the same CSS dimensions as the overlay coordinate system.
    canvas.style.width   = `${cssWidth}px`
    canvas.style.height  = `${cssHeight}px`
    canvas.style.display = "block"
    el.appendChild(canvas)
  }, [canvas, cssWidth, cssHeight])
  return (
    <div
      ref={ref}
      style={{ width: cssWidth, height: cssHeight }}
    />
  )
}
