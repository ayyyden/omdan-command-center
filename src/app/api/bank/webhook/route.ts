import { createServiceClient } from "@/lib/supabase/service"
import { verifyPlaidWebhook } from "@/lib/plaid-webhook"
import { resolveAssistantOwnerUserId } from "@/lib/assistant-owner"
import { syncOneItem, draftBankActivity, type PlaidItemRow } from "@/lib/bank-sync"

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

  const { data: item, error: itemErr } = await service
    .from("plaid_items")
    .select("id, access_token, institution_name, cursor")
    .eq("item_id", body.item_id)
    .eq("status", "active")
    .single()

  if (itemErr || !item) {
    console.error("[bank/webhook] unknown or inactive item_id:", body.item_id, itemErr?.message)
    return Response.json({ ok: true, skipped: true }) // still 200 — nothing Plaid should retry over
  }

  const { userId, error: ownerErr } = await resolveAssistantOwnerUserId(service)
  if (!userId) {
    console.error("[bank/webhook] could not resolve owner:", ownerErr)
    return Response.json({ ok: true, skipped: true })
  }

  try {
    const { result, expenseCandidates, depositCandidates } = await syncOneItem(service, item as PlaidItemRow)
    let drafted = 0, flagged = 0, autoIgnored = 0
    if (expenseCandidates.length || depositCandidates.length) {
      const summary = await draftBankActivity(service, userId, expenseCandidates, depositCandidates)
      drafted = summary.drafted
      flagged = summary.flagged
      autoIgnored = summary.autoIgnored
    }
    console.log(`[bank/webhook] synced item ${item.id} — added=${result.added} drafted=${drafted} flagged=${flagged} auto_ignored=${autoIgnored}`)
    return Response.json({ ok: true, result, drafted, flagged, auto_ignored: autoIgnored })
  } catch (err) {
    console.error("[bank/webhook] sync failed:", err)
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
