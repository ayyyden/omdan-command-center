import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { runBankReview } from "@/lib/bank-review"

// Classification of a full batch (adaptive thinking, up to 45 transactions)
// can take a while — give it room instead of getting killed mid-run.
export const maxDuration = 300

// POST /api/bank/review
// Sorts every new, unhandled bank transaction and sends Lia a one-tap
// digest (see src/lib/bank-review.ts). Called daily by the lia-bridge
// scheduler, or manually by a bank:manage user.
export async function POST(req: Request) {
  const secretHeader = req.headers.get("x-assistant-secret")
  const isCron = !!secretHeader && secretHeader === process.env.ASSISTANT_SECRET
  if (!isCron) {
    const session = await requirePermission("bank:manage")
    if (session instanceof Response) return session
  }

  // Backlog / testing knobs — only honored for the internal secret caller.
  const url = new URL(req.url)
  const opts = isCron ? {
    dryRun: url.searchParams.get("dry_run") === "1",
    since:  url.searchParams.get("since") ?? undefined,
    until:  url.searchParams.get("until") ?? undefined,
    limit:  url.searchParams.get("limit") ? Math.min(150, Number(url.searchParams.get("limit"))) : undefined,
  } : {}

  try {
    const result = await runBankReview(createServiceClient(), opts)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    console.error("[bank/review] failed:", err)
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
