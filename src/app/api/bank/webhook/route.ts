import { createServiceClient } from "@/lib/supabase/service"
import { verifyPlaidWebhook } from "@/lib/plaid-webhook"
import { syncOneItem, type PlaidItemRow } from "@/lib/bank-sync"

export const maxDuration = 300

// POST /api/bank/webhook
// Plaid calls this the moment IT has new transaction data for an Item —
// this is what makes bank activity show up in near-real-time instead of
// waiting for the next scheduled poll. Registered via the `webhook` field on
// /link/token/create for new connections; existing Items were pointed here
// via a one-time /item/webhook/update call.
//
// Public endpoint (Plaid can't send our shared secret) — authenticity is
// verified via the Plaid-Verification JWT header instead. See
// src/lib/plaid-webhook.ts for the verification scheme.
export async function POST(req: Request) {
  // Read the RAW body text first — verification hashes the literal bytes
  // Plaid sent; re-serializing a parsed object could produce different
  // whitespace and spuriously fail the check.
  const rawBody = await req.text()

  const verification = await verifyPlaidWebhook(rawBody, req.headers.get("plaid-verification"))
  if (!verification.ok) {
    console.error("[bank/webhook] verification failed:", verification.error)
    return Response.json({ error: verification.error }, { status: 401 })
  }

  let body: { webhook_type?: string; webhook_code?: string; item_id?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Always 200 quickly for anything we don't act on — Plaid sends many
  // webhook types (item errors, historical-update-complete, etc.); we only
  // care about this one. Not erroring on the rest avoids Plaid retrying
  // webhooks we were never going to do anything with.
  if (body.webhook_type !== "TRANSACTIONS" || body.webhook_code !== "SYNC_UPDATES_AVAILABLE" || !body.item_id) {
    return Response.json({ ok: true, skipped: true })
  }

  const service = createServiceClient()

  // Any non-revoked item — one stuck in "error" from an earlier transient
  // failure must still be able to recover when Plaid pings us.
  const { data: item, error: itemErr } = await service
    .from("plaid_items")
    .select("id, access_token, institution_name, cursor, status")
    .eq("item_id", body.item_id)
    .neq("status", "revoked")
    .single()

  if (itemErr || !item) {
    console.error("[bank/webhook] unknown or revoked item_id:", body.item_id, itemErr?.message)
    return Response.json({ ok: true, skipped: true }) // still 200 — nothing Plaid should retry over
  }

  // Store only — sorting into expenses/payments happens in the daily
  // /api/bank/review digest, so Lia sends one message instead of one per charge.
  const result = await syncOneItem(service, item as PlaidItemRow)
  console.log(`[bank/webhook] synced item ${item.id} — added=${result.added} modified=${result.modified} removed=${result.removed}${result.error ? ` error=${result.error}` : ""}`)
  return Response.json({ ok: !result.error, result })
}
