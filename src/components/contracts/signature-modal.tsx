"use client"

import { useRef, useState, useEffect } from "react"

// Enlarged from the original 560×200 / 300×200 — the "signature pad is
// cramped" was part of the "whole flow feels off" complaint. Still a plain
// canvas (no external signature library needed) — mouse + touch, Clear,
// Cancel, Done.
const MODAL_W = 640
const MODAL_H = 240
const INITIALS_W = 360
const INITIALS_H = 220

export function SignatureModal({
  type,
  signerName,
  onDone,
  onCancel,
}: {
  type: "signature" | "initials"
  signerName: string
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
      ctx.lineWidth = 3
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

  const title = type === "initials" ? "Add Your Initials" : "Sign Here"
  const hint  = type === "initials" ? "Draw your initials with your finger or mouse" : "Draw your signature with your finger or mouse"

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl flex flex-col"
        style={{ width: Math.min(cw + 48, typeof window !== "undefined" ? window.innerWidth - 32 : 688) }}
      >
        <div className="px-6 pt-5 pb-3 border-b border-slate-100">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <p className="text-sm text-slate-400 mt-0.5">{hint}</p>
          {signerName && (
            <p className="text-xs text-slate-400 mt-1">
              Signing as <span className="font-medium text-slate-600">{signerName}</span>
            </p>
          )}
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
                <span className="text-slate-300 text-base select-none">
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
            className="text-sm font-medium text-slate-500 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
