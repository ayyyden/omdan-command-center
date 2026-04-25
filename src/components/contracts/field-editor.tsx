"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { usePdfPages } from "@/lib/use-pdf-pages"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Save, Trash2, AlignLeft, AlignCenter, AlignRight } from "lucide-react"

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
}

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
  if (ft === "signature") return "bottom"
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
            {pages.map((pg) => {
              const pageFields = fields.filter((f) => f.page_number === pg.pageNumber)
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

                      return (
                        <div
                          key={f.id}
                          className={`absolute border-2 rounded-sm cursor-move flex items-start overflow-hidden ${FIELD_COLORS[f.field_type]} ${isSelected ? "ring-2 ring-primary ring-offset-0" : ""}`}
                          style={{ left: fx, top: fy, width: fw, height: fh }}
                          onMouseDown={(e) => startDrag(e, f.id, "move", pg.width, pg.height)}
                          onClick={(e) => { e.stopPropagation(); setSelectedId(f.id); setAddingType(null) }}
                        >
                          <span className="text-[10px] font-medium px-1 pt-0.5 truncate select-none leading-none">
                            {f.required ? "* " : ""}{f.label}
                          </span>
                          <div
                            className="absolute bottom-0 right-0 w-3 h-3 bg-primary/80 cursor-se-resize"
                            onMouseDown={(e) => startDrag(e, f.id, "resize", pg.width, pg.height)}
                          />
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
