import { ImageResponse } from "next/og"
import { MARK_PATHS } from "@/components/brand/omdan-mark"

// App icon: the gold Omdan tower mark on basalt. Used for the favicon,
// the iPhone home-screen icon and the PWA manifest icons.
export function brandIcon(size: number, { maskable = false }: { maskable?: boolean } = {}) {
  // Maskable icons get cropped to a circle/squircle by the OS — keep the
  // mark inside the safe zone and fill edge to edge.
  const inset = maskable ? 0.24 : 0.16
  const mark = Math.round(size * (1 - inset * 2))
  const radius = maskable || size >= 180 ? 0 : Math.round(size * 0.22)
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#1A1E1C", borderRadius: radius,
        }}
      >
        <svg width={mark} height={mark} viewBox="0 0 64 64" fill="none">
          {MARK_PATHS.map((d) => (
            <path key={d} d={d} stroke="#D4B05A" strokeWidth={size <= 32 ? 4 : 3} strokeLinecap="square" strokeLinejoin="miter" />
          ))}
        </svg>
      </div>
    ),
    { width: size, height: size },
  )
}
