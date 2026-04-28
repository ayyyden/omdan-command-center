import { ImageResponse } from "next/og"

export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        background: "#4F46E5",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <span
        style={{
          color: "#ffffff",
          fontSize: 100,
          fontWeight: 800,
          fontFamily: "sans-serif",
          letterSpacing: "-2px",
        }}
      >
        O
      </span>
    </div>,
    { ...size },
  )
}
