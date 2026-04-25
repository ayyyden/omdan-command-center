"use client"

import { useRef, useState, useEffect } from "react"
import { usePdfPages } from "@/lib/use-pdf-pages"
import type { FieldType, FieldOptions } from "@/components/contracts/field-editor"
import { TEXT_FORMAT_DEFAULTS } from "@/components/contracts/field-editor"

export interface SigningField {
  id: string
  page_number: number
  field_type: FieldType
  label: string
  x: number
  y: number
  width: number
  height: number
  required: boolean
  options?: FieldOptions | null
}

interface Props {
  token: string
  contractName: string
  pdfUrl: string | null
  fields: SigningField[]
}

// ── Signature modal ───────────────────────────────────────────────────────────

const MODAL_W = 560
const MODAL_H = 200
const INITIALS_W = 300
const INITIALS_H = 200

function SignatureModal({
  type,
  onDone,
  onCancel,
}: {
  type: "signature" | "initials"
  onDone: (dataUrl: string) => void
  onCancel: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  const cw = type === "initials" ? INITIALS_W : MODAL_W
  const ch = type === "initials" ? INITIALS_H : MODAL_H

  function getPos(canvas: HTMLCanvasElement, e: MouseEvent | Touch) {
    const r = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (canvas.width  / r.width),
      y: (e.clientY - r.top)  * (canvas.height / r.height),
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function down(e: MouseEvent | TouchEvent) {
      e.preventDefault()
      drawing.current = true
      const ctx = canvas!.getContext("2d")!
      const p = getPos(canvas!, "touches" in e ? e.touches[0] : e as MouseEvent)
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
    }

    function move(e: MouseEvent | TouchEvent) {
      if (!drawing.current) return
      e.preventDefault()
      const ctx = canvas!.getContext("2d")!
      const p = getPos(canvas!, "touches" in e ? e.touches[0] : e as MouseEvent)
      ctx.lineTo(p.x, p.y)
      ctx.strokeStyle = "#1e293b"
      ctx.lineWidth = 2.5
      ctx.lineCap = "round"
      ctx.lineJoin = "round"
      ctx.stroke()
      setHasDrawn(true)
    }

    function up() { drawing.current = false }

    canvas.addEventListener("mousedown", down)
    canvas.addEventListener("mousemove", move)
    canvas.addEventListener("mouseup", up)
    canvas.addEventListener("mouseleave", up)
    canvas.addEventListener("touchstart", down, { passive: false })
    canvas.addEventListener("touchmove", move, { passive: false })
    canvas.addEventListener("touchend", up)

    return () => {
      canvas.removeEventListener("mousedown", down)
      canvas.removeEventListener("mousemove", move)
      canvas.removeEventListener("mouseup", up)
      canvas.removeEventListener("mouseleave", up)
      canvas.removeEventListener("touchstart", down)
      canvas.removeEventListener("touchmove", move)
      canvas.removeEventListener("touchend", up)
    }
  }, [])

  function clear() {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  function done() {
    if (!hasDrawn) return
    const canvas = canvasRef.current
    if (!canvas) return
    onDone(canvas.toDataURL("image/png"))
  }

  const title = type === "initials" ? "Add Initials" : "Sign Here"
  const hint  = type === "initials" ? "Draw your initials" : "Draw your signature"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: Math.min(cw + 48, typeof window !== "undefined" ? window.innerWidth - 32 : 608) }}
      >
        <div className="px-6 pt-5 pb-3 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="text-xs text-slate-400 mt-0.5">{hint} in the box below</p>
        </div>

        <div className="px-6 py-4">
          <div
            className="relative rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden"
            style={{ width: "100%", paddingBottom: `${(ch / cw) * 100}%` }}
          >
            <canvas
              ref={canvasRef}
              width={cw}
              height={ch}
              className="absolute inset-0 w-full h-full cursor-crosshair touch-none"
            />
            {!hasDrawn && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-slate-300 text-sm select-none">
                  {type === "initials" ? "Initials here" : "Signature here"}
                </span>
              </div>
            )}
          </div>
          <div className="h-px bg-slate-200 mx-0 mt-1" />
        </div>

        <div className="px-6 pb-5 flex items-center justify-between">
          <button
            type="button"
            onClick={clear}
            disabled={!hasDrawn}
            className="text-sm text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Clear
          </button>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={done}
              disabled={!hasDrawn}
              className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main signing client ───────────────────────────────────────────────────────

export function SignClient({ token, contractName, pdfUrl, fields }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  const { pages, loading: pdfLoading, error: pdfError } = usePdfPages(pdfUrl, containerWidth)

  const [values, setValues]         = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]             = useState(false)
  const [error, setError]           = useState("")
  const [signerName, setSignerName] = useState("")
  const [modalField, setModalField] = useState<SigningField | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setContainerWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setContainerWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  function setValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  async function handleSubmit() {
    setError("")

    for (const f of fields) {
      if (f.required) {
        const v = values[f.id] ?? ""
        if (!v.trim()) {
          setError(`"${f.label}" is required.`)
          return
        }
      }
    }

    if (!signerName.trim()) {
      setError("Please enter your full name to complete signing.")
      return
    }

    setSubmitting(true)

    const res = await fetch(`/api/contracts/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerName: signerName.trim(), fieldValues: values }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? "Signing failed. Please try again.")
      return
    }

    setDone(true)
  }

  if (done) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Contract Signed</h1>
          <p className="text-gray-500 mb-1">
            Thank you, <span className="font-medium text-gray-700">{signerName}</span>.
          </p>
          <p className="text-sm text-gray-400">Your signature has been recorded. You may close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {modalField && (
        <SignatureModal
          type={modalField.field_type as "signature" | "initials"}
          onDone={(dataUrl) => {
            setValue(modalField.id, dataUrl)
            setModalField(null)
          }}
          onCancel={() => setModalField(null)}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="mb-6">
            <p className="text-sm text-slate-500 font-medium mb-1">Contract for signature</p>
            <h1 className="text-2xl font-semibold text-slate-900">{contractName}</h1>
          </div>

          <div
            ref={containerRef}
            className="bg-white rounded-xl border shadow-sm overflow-hidden mb-6"
          >
            {pdfLoading || containerWidth === 0 ? (
              <div className="flex items-center justify-center min-h-[14rem] text-gray-400 text-sm gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Loading contract…
              </div>
            ) : pdfError || !pdfUrl ? (
              <div className="flex flex-col items-center justify-center min-h-[14rem] gap-3 p-6 text-center">
                <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-gray-600">Could not load the contract PDF</p>
                  {pdfError && <p className="text-xs text-gray-400 mt-1">{pdfError}</p>}
                  <p className="text-xs text-gray-400 mt-1">Please contact the sender for a new signing link.</p>
                </div>
              </div>
            ) : (
              <div>
                {pages.map((pg) => {
                  const pageFields = fields.filter((f) => f.page_number === pg.pageNumber)
                  const pdfScale = pg.width / pg.pdfWidth
                  return (
                    <div
                      key={pg.pageNumber}
                      className="relative"
                      style={{ width: pg.width, height: pg.height }}
                    >
                      <CanvasDisplay canvas={pg.canvas} cssWidth={pg.width} cssHeight={pg.height} />

                      {pageFields.map((f) => {
                        const fx = f.x * pg.width
                        const fy = f.y * pg.height
                        const fw = f.width  * pg.width
                        const fh = f.height * pg.height

                        return (
                          <FieldInput
                            key={f.id}
                            field={f}
                            value={values[f.id] ?? ""}
                            onChange={(v) => setValue(f.id, v)}
                            onOpenModal={() => setModalField(f)}
                            pdfScale={pdfScale}
                            style={{
                              position: "absolute",
                              left: fx,
                              top:  fy,
                              width: fw,
                              height: fh,
                            }}
                          />
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl border shadow-sm p-6 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Complete Signing</h2>

            <div>
              <label className="block text-sm font-semibold text-slate-800 mb-1.5">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Your full legal name"
                className="w-full border-2 border-slate-300 rounded-lg px-3 py-2 text-sm font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {error && (
              <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <div className="pt-2 border-t border-slate-200">
              <p className="text-xs text-slate-500 mb-4">
                By clicking &ldquo;Sign &amp; Submit&rdquo; you agree that this electronic signature is the
                legal equivalent of your handwritten signature.
              </p>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-3 transition-colors text-sm"
              >
                {submitting ? "Submitting…" : "Sign & Submit"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Field input renderer ──────────────────────────────────────────────────────

function FieldInput({
  field,
  value,
  onChange,
  onOpenModal,
  pdfScale,
  style,
}: {
  field: SigningField
  value: string
  onChange: (v: string) => void
  onOpenModal: () => void
  pdfScale: number
  style: React.CSSProperties
}) {
  function textStyle(ft: FieldType): React.CSSProperties {
    const d = TEXT_FORMAT_DEFAULTS[ft] ?? TEXT_FORMAT_DEFAULTS.text
    const opts = field.options ?? {}
    return {
      fontSize:      `${(opts.fontSize  ?? d.fontSize)  * pdfScale}px`,
      lineHeight:    opts.lineHeight ?? d.lineHeight,
      fontWeight:    opts.fontWeight ?? d.fontWeight,
      textAlign:     (opts.textAlign  ?? d.textAlign) as React.CSSProperties["textAlign"],
      padding:       `${(opts.padding  ?? d.padding)   * pdfScale}px`,
      fontFamily:    "Helvetica, Arial, sans-serif",
      color:         "#0d0d1a",
    }
  }

  switch (field.field_type) {
    case "text":
      return (
        <div style={style} title={field.label}>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.label}
            className="w-full h-full focus:outline-none bg-transparent border-0 placeholder:text-slate-400/60"
            style={textStyle("text")}
          />
        </div>
      )

    case "multiline":
      return (
        <div style={style} title={field.label}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.label}
            className="w-full h-full focus:outline-none bg-transparent border-0 resize-none placeholder:text-slate-400/60"
            style={textStyle("multiline")}
          />
        </div>
      )

    case "rich_text":
      return (
        <div style={style} title={field.label}>
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.label}
            className="w-full h-full resize-none focus:outline-none bg-transparent border-0 placeholder:text-slate-400/60"
            style={{ ...textStyle("rich_text"), letterSpacing: "0.01em" }}
          />
        </div>
      )

    case "date":
      return (
        <div style={style} title={field.label}>
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-full focus:outline-none bg-transparent border-0"
            style={textStyle("date")}
          />
        </div>
      )

    case "signature":
    case "initials": {
      const isInitials = field.field_type === "initials"
      return (
        <div
          style={style}
          title={field.label}
          onClick={onOpenModal}
          className="cursor-pointer group"
        >
          {value ? (
            <img
              src={value}
              alt={field.label}
              className="w-full h-full object-contain"
              style={{ display: "block" }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 rounded border border-dashed border-slate-400/60 group-hover:border-blue-400 group-hover:bg-blue-50/30 transition-colors">
              <svg
                className="text-slate-400 group-hover:text-blue-400 transition-colors"
                style={{ width: Math.min(16, (style.height as number) * 0.4), height: Math.min(16, (style.height as number) * 0.4) }}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
              </svg>
              {(style.height as number) > 28 && (
                <span className="text-[10px] text-slate-400 group-hover:text-blue-500 transition-colors leading-none">
                  {isInitials ? "Tap to initial" : "Tap to sign"}
                </span>
              )}
            </div>
          )}
        </div>
      )
    }

    case "checkbox":
      return (
        <div style={style} className="flex items-center justify-center" title={field.label}>
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
            className="w-4 h-4 rounded border-blue-300 accent-blue-600"
          />
        </div>
      )

    case "yes_no": {
      const ynStyle = textStyle("yes_no")
      const d = TEXT_FORMAT_DEFAULTS.yes_no
      const opts = field.options ?? {}
      const align = opts.textAlign ?? d.textAlign
      const justifyMap = { left: "flex-start", center: "center", right: "flex-end" }
      return (
        <div
          style={{ ...style, display: "flex", alignItems: "center", justifyContent: justifyMap[align] ?? "center", gap: "8px", padding: ynStyle.padding }}
          title={field.label}
        >
          {["Yes", "No"].map((opt) => (
            <label
              key={opt}
              className="flex items-center gap-1 cursor-pointer"
              style={{ fontSize: ynStyle.fontSize, fontWeight: ynStyle.fontWeight, fontFamily: ynStyle.fontFamily as string, color: ynStyle.color as string }}
            >
              <input
                type="radio"
                name={`yn-${field.id}`}
                checked={value === opt}
                onChange={() => onChange(opt)}
                className="accent-blue-600"
              />
              {opt}
            </label>
          ))}
        </div>
      )
    }

    default:
      return null
  }
}

// ── Canvas display helper ─────────────────────────────────────────────────────

function CanvasDisplay({ canvas, cssWidth, cssHeight }: { canvas: HTMLCanvasElement; cssWidth: number; cssHeight: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ""
    // Scale the canvas buffer to CSS pixel dimensions so retina canvases don't overflow
    canvas.style.width  = "100%"
    canvas.style.height = "100%"
    canvas.style.display = "block"
    el.appendChild(canvas)
  }, [canvas])
  return <div ref={ref} style={{ width: cssWidth, height: cssHeight }} />
}
