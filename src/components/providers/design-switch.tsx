"use client"

// One switch between the new "studio" look and the original "classic" look.
// The whole redesign hangs off <html data-design="…">: studio colours, type
// and components are CSS scoped to that attribute, and studio-only /
// classic-only elements are hidden by CSS. Flipping it is instant — no
// reload, no deploy — and it's remembered per device in localStorage.

import { useEffect, useState } from "react"
import { Paintbrush, Undo2 } from "lucide-react"
import { cn } from "@/lib/utils"

import { DESIGN_KEY, type Design } from "@/lib/design"

export type { Design }

function readDesign(): Design {
  if (typeof document === "undefined") return "studio"
  return document.documentElement.getAttribute("data-design") === "classic" ? "classic" : "studio"
}

export function setDesign(d: Design) {
  document.documentElement.setAttribute("data-design", d)
  try { localStorage.setItem(DESIGN_KEY, d) } catch {}
  window.dispatchEvent(new CustomEvent("design-change", { detail: d }))
}

export function useDesign(): Design {
  const [design, setState] = useState<Design>("studio")
  useEffect(() => {
    setState(readDesign())
    const h = (e: Event) => setState((e as CustomEvent<Design>).detail)
    window.addEventListener("design-change", h)
    return () => window.removeEventListener("design-change", h)
  }, [])
  return design
}

/** Button that flips to the other look. `tone` matches the surface it sits on. */
export function DesignSwitchButton({ className, compact = false, short = false, labelClassName }: { className?: string; compact?: boolean; short?: boolean; labelClassName?: string }) {
  const design = useDesign()
  const toClassic = design === "studio"
  const Icon = toClassic ? Undo2 : Paintbrush
  const label = toClassic ? "Switch to classic look" : "Try the new look"
  const text = short ? (toClassic ? "Classic look" : "New look") : label
  return (
    <button
      type="button"
      onClick={() => setDesign(toClassic ? "classic" : "studio")}
      className={cn("flex items-center gap-3 w-full text-sm font-medium transition-colors", className)}
      title={label}
      aria-label={label}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {!compact && <span className={cn("truncate", labelClassName)}>{text}</span>}
    </button>
  )
}
