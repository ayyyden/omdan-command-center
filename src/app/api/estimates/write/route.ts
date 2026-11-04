import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { writeEstimate, type WrittenEstimate } from "@/lib/estimate-writer"

export const maxDuration = 180

// POST /api/estimates/write { brief } → title, numbered scope sections,
// payment schedule and project notes written from the short note.
export async function POST(req: NextRequest) {
  const session = await requirePermission("estimates:create")
  if (session instanceof Response) return session

  const { brief, change, current } = (await req.json().catch(() => ({}))) as { brief?: string; change?: string; current?: WrittenEstimate }
  if (!brief?.trim() || brief.trim().length < 8) return Response.json({ error: "Describe the job first" }, { status: 400 })

  try {
    // "change" + "current": revise the estimate already written instead of starting over
    const revise = change?.trim() && current?.sections ? { current, change: change.trim().slice(0, 2000) } : undefined
    return Response.json(await writeEstimate(brief.trim().slice(0, 6000), revise))
  } catch (err) {
    console.error("[estimates/write] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
