import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { syncAllItems } from "@/lib/bank-sync"

// A full multi-page Plaid sync plus a balance refresh can run long — don't
// let the platform kill it mid-way (a killed sync is what used to strand
// the item in "error").
export const maxDuration = 300

// POST /api/bank/sync
// Full sweep of every non-revoked plaid_items row (errored ones included, so
// they recover on their own). This is the manual "Sync now" button and the
// bridge's cron safety net — the primary, near-real-time trigger is the
// SYNC_UPDATES_AVAILABLE webhook (/api/bank/webhook). Sync only stores
// transactions; sorting them happens in /api/bank/review (daily digest).
//
// Auth: either a real bank:manage session (the UI's "Sync now" button), or
// the shared assistant secret (the bridge's scheduled cron).
export async function POST(req: Request) {
  const secretHeader = req.headers.get("x-assistant-secret")
  const isCron = !!secretHeader && secretHeader === process.env.ASSISTANT_SECRET
  if (!isCron) {
    const session = await requirePermission("bank:manage")
    if (session instanceof Response) return session
  }

  try {
    const { results } = await syncAllItems(createServiceClient())
    return Response.json({ ok: true, results })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
