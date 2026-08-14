import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { resolveAssistantOwnerUserId } from "@/lib/assistant-owner"
import { syncAllActiveItems } from "@/lib/bank-sync"

// POST /api/bank/sync
// Full sweep of every active plaid_items row. This is the manual "Sync now"
// button and a low-frequency cron safety net — the primary, near-real-time
// trigger is now the SYNC_UPDATES_AVAILABLE webhook (/api/bank/webhook),
// which fires the moment Plaid itself has something new instead of us
// guessing a polling interval. See src/lib/bank-sync.ts for the actual sync
// + auto-draft logic, shared by both paths.
//
// Auth: either a real bank:manage session (the UI's "Sync now" button), or
// the shared assistant secret (the bridge's scheduled cron) — cron has no
// browser session, so it authenticates as the CRM's designated owner instead
// (same resolution execute/[id]/route.ts uses).
export async function POST(req: Request) {
  const service = createServiceClient()
  let syncUserId: string

  const secretHeader = req.headers.get("x-assistant-secret")
  if (secretHeader && secretHeader === process.env.ASSISTANT_SECRET) {
    const { userId, error } = await resolveAssistantOwnerUserId(service)
    if (!userId) return Response.json({ error: error ?? "Owner not found" }, { status: 500 })
    syncUserId = userId
  } else {
    const session = await requirePermission("bank:manage")
    if (session instanceof Response) return session
    syncUserId = session.userId
  }

  try {
    const { results, drafted, flagged, autoIgnored } = await syncAllActiveItems(service, syncUserId)
    return Response.json({ ok: true, results, drafted, flagged, auto_ignored: autoIgnored })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
