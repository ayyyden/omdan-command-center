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
export function usePdfPages(url: string | null, containerWidth: number) {
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
    setPages([])

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
  }, [url, containerWidth])

  return { pages, loading, error }
}
