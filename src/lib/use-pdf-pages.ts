"use client"

import { useEffect, useRef, useState } from "react"

export interface RenderedPage {
  pageNumber: number
  canvas: HTMLCanvasElement
  width: number  // rendered pixel width
  height: number // rendered pixel height
  pdfWidth: number  // native PDF width in points
  pdfHeight: number // native PDF height in points
}

// Renders all pages of a PDF (via signed URL) to canvas elements.
// containerWidth determines the render scale; pages wider than container are scaled down.
// keepPrevious: leave the old pages on screen until the new ones are ready
// (the field editor's Live test re-renders on every change — no flashing).
export function usePdfPages(url: string | null, containerWidth: number, opts: { keepPrevious?: boolean } = {}) {
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!url || containerWidth <= 0) return
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    let cancelled = false
    setLoading(true)
    setError(null)
    if (!opts.keepPrevious) setPages([])

    async function render() {
      try {
        const pdfjsLib = await import("pdfjs-dist")
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"

        const loadingTask = pdfjsLib.getDocument(url!)
        const pdfDoc = await loadingTask.promise
        if (cancelled) return

        const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1
        const rendered: RenderedPage[] = []

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          if (cancelled) return
          const page = await pdfDoc.getPage(i)
          const nativeViewport = page.getViewport({ scale: 1 })
          // Render at DPR scale for crisp display on retina screens
          const scale = (containerWidth / nativeViewport.width) * dpr
          const viewport = page.getViewport({ scale })

          const canvas = document.createElement("canvas")
          canvas.width  = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)

          await page.render({ canvas, viewport }).promise
          if (cancelled) return

          // CSS dimensions are derived purely from the aspect ratio — no DPR in these values.
          // Field overlay positions and CanvasDisplay both use these CSS dimensions so
          // the coordinate systems always match, regardless of devicePixelRatio.
          const cssWidth  = containerWidth
          const cssHeight = Math.round(containerWidth * nativeViewport.height / nativeViewport.width)

          rendered.push({
            pageNumber: i,
            canvas,
            width:     cssWidth,
            height:    cssHeight,
            pdfWidth:  nativeViewport.width,
            pdfHeight: nativeViewport.height,
          })
        }

        setPages(rendered)
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to render PDF")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    render()
    return () => { cancelled = true; ac.abort() }
  }, [url, containerWidth]) // eslint-disable-line react-hooks/exhaustive-deps

  return { pages, loading, error }
}

// The line finder (contracts/detect-lines.ts) reads pixels, and on screen a
// page is often only ~800 px wide — thin scanned lines blur to light gray
// there and break into pieces. Detection always runs on its own sharp copy
// of each page instead, rendered once per PDF at ANALYSIS_WIDTH.
const ANALYSIS_WIDTH = 1600
const analysisCache = new Map<string, Promise<Map<number, HTMLCanvasElement>>>()

export function renderPagesForAnalysis(url: string): Promise<Map<number, HTMLCanvasElement>> {
  let job = analysisCache.get(url)
  if (!job) {
    job = (async () => {
      const pdfjsLib = await import("pdfjs-dist")
      pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"
      const pdfDoc = await pdfjsLib.getDocument(url).promise
      const out = new Map<number, HTMLCanvasElement>()
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i)
        const native = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: Math.max(1, ANALYSIS_WIDTH / native.width) })
        const canvas = document.createElement("canvas")
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await page.render({ canvas, viewport }).promise
        out.set(i, canvas)
      }
      return out
    })()
    job.catch(() => analysisCache.delete(url))
    analysisCache.set(url, job)
  }
  return job
}
