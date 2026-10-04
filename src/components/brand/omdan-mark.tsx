import { cn } from "@/lib/utils"

// The Omdan three-tower mark, redrawn as clean vector strokes from the
// company logo (gold line towers standing on a base line). Used by the
// "studio" design: sidebar, login, dashboard hero and the app icons.

export const MARK_PATHS = [
  "M5 55H59",          // base line
  "M15 55V27L24.5 20V55", // left tower
  "M28.5 55V7L39 16V55",  // tall middle tower
  "M39 29L48.5 36.5V55",  // right tower, leaning on the middle one
] as const

interface MarkProps {
  className?: string
  /** Draw the strokes in on mount (one orchestrated moment — dashboard + login only). */
  animated?: boolean
  strokeWidth?: number
  /** Solid colour instead of the brass gradient (e.g. on a gold background). */
  color?: string
  title?: string
  /** Unique per placement — a gradient defined inside a hidden (display:none)
   *  SVG can't be referenced by another, so instances must not share ids. */
  id?: string
}

export function OmdanMark({ className, animated = false, strokeWidth = 2.6, color, title = "Omdan", id = "mark" }: MarkProps) {
  const gid = `omdan-brass-${id}`
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn(animated && "omdan-mark-draw", className)}
    >
      {!color && (
        <defs>
          <linearGradient id={gid} x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#ECD48A" />
            <stop offset="0.55" stopColor="#C9A246" />
            <stop offset="1" stopColor="#9C7826" />
          </linearGradient>
        </defs>
      )}
      {MARK_PATHS.map((d, i) => (
        <path
          key={d}
          d={d}
          pathLength={1}
          stroke={color ?? `url(#${gid})`}
          strokeWidth={strokeWidth}
          strokeLinecap="square"
          strokeLinejoin="miter"
          style={animated ? { animationDelay: `${120 + i * 160}ms` } : undefined}
        />
      ))}
    </svg>
  )
}

/** Mark + "OMDAN" wordmark, matching the logo's Trajan-style capitals. */
export function OmdanLockup({ className, sub = "Command Center", animated = false, id = "lockup" }: { className?: string; sub?: string | null; animated?: boolean; id?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-3", className)}>
      <OmdanMark id={id} animated={animated} className="h-9 w-9 shrink-0" />
      <span className="flex flex-col leading-none">
        <span className="font-title text-[19px] tracking-[0.18em] text-[var(--brass-text)]">OMDAN</span>
        {sub && <span className="mt-1 text-[11px] tracking-[0.04em] opacity-60">{sub}</span>}
      </span>
    </span>
  )
}
