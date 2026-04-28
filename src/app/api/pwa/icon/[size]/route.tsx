import { ImageResponse } from "next/og"
import type { NextRequest } from "next/server"

export const runtime = "edge"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size: sizeStr } = await params
  const size = sizeStr === "512" ? 512 : 192
  const radius = Math.round(size * 0.18)
  const fontSize = Math.round(size * 0.52)

  return new ImageResponse(
    (
      <div
        style={{
          background: "#4F46E5",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
        }}
      >
        <span
          style={{
            color: "#ffffff",
            fontSize,
            fontWeight: 800,
            fontFamily: "sans-serif",
            letterSpacing: `${-size * 0.01}px`,
          }}
        >
          O
        </span>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    },
  )
}
