"use client"

import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { usePdfPages } from "@/lib/use-pdf-pages"

// Shows a PDF right on the page (every page, full width) — used on the
// signing screens so the customer sees the document already filled with
// the company's part before signing, instead of a "open in new tab" link.
export function PdfViewer({ url, className }: { url: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)))
    ro.observe(el)
    setWidth(Math.floor(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])

  const { pages, loading, error } = usePdfPages(url, width)

  return (
    <div ref={ref} className={className}>
      {loading && !pages.length && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading the document…
        </div>
      )}
      {error && <p className="py-8 text-center text-sm text-red-600">Couldn&apos;t show the document. <a className="underline" href={url} target="_blank" rel="noopener noreferrer">Open it in a new tab</a>.</p>}
      <div className="space-y-3">
        {pages.map((p) => <PageCanvas key={p.pageNumber} canvas={p.canvas} width={p.width} height={p.height} />)}
      </div>
    </div>
  )
}

function PageCanvas({ canvas, width, height }: { canvas: HTMLCanvasElement; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = ""
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    canvas.style.display = "block"
    el.appendChild(canvas)
  }, [canvas, width, height])
  return <div ref={ref} className="rounded-md overflow-hidden border border-slate-200 bg-white shadow-sm" style={{ width, height }} />
}
