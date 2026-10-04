import { brandIcon } from "@/lib/brand-icon"

// PWA manifest icons: /brand-icon?size=192 | 512, &maskable=1
export function GET(req: Request) {
  const url = new URL(req.url)
  const size = url.searchParams.get("size") === "512" ? 512 : 192
  return brandIcon(size, { maskable: url.searchParams.get("maskable") === "1" })
}
