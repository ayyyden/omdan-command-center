// Core Plaid transaction sync logic — shared by the manual "Sync now" button,
// the scheduled cron fallback, and the SYNC_UPDATES_AVAILABLE webhook (the
// primary trigger; the other two are safety nets in case a webhook is missed).
//
// Sync only STORES transactions. Sorting them into expenses / customer
// payments / skips happens once a day in src/lib/bank-review.ts, which sends
// Lia a single digest with one-tap Save All — instead of the old
// one-approval-card-per-charge flow that flooded Telegram (a daily $188
// Facebook charge alone was 30 cards a month).
//
// Reliability: an item that hits an error is NOT abandoned. Every sync path
// used to filter on status = "active", so a single transient Plaid
// "Gateway Timeout" (Sept 2026) flipped the item to "error" and silently
// stopped all syncing for weeks. Now every non-revoked item is retried on
// every run, transient 5xx/timeouts are retried in-place, and Lia is told
// when a connection breaks and when it recovers.

import { createServiceClient } from "@/lib/supabase/service"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"
import { notifyLiaAction } from "@/lib/lia-notifications"

type ServiceClient = ReturnType<typeof createServiceClient>

export interface PlaidItemRow {
  id:                string
  access_token:      string
  institution_name:  string | null
  cursor:            string | null
  status?:           string | null
}

export interface ItemSyncResult {
  item_id: string
  institution_name: string | null
  added: number
  modified: number
  removed: number
  error?: string
}

// Plaid 5xx / gateway timeouts / rate limits are transient — worth a couple
// of quick retries before giving up on this run. Auth problems
// (ITEM_LOGIN_REQUIRED etc.) are not, and need the user to reconnect.
function isTransientPlaidError(err: unknown): boolean {
  const e = err as { response?: { status?: number; data?: { error_type?: string; error_code?: string } }; code?: string }
  const status = e?.response?.status
  if (status && (status >= 500 || status === 429)) return true
  const type = e?.response?.data?.error_type
  if (type === "API_ERROR" || type === "RATE_LIMIT_EXCEEDED" || type === "INSTITUTION_ERROR") return true
  if (e?.code === "ECONNRESET" || e?.code === "ETIMEDOUT" || e?.code === "ECONNABORTED") return true
  return /gateway timeout|timed? ?out|socket hang up/i.test(plaidErrorMessage(err))
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransientPlaidError(err) || i === attempts - 1) break
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
    }
  }
  throw lastErr
}

function needsReconnect(message: string): boolean {
  return /ITEM_LOGIN_REQUIRED|PENDING_EXPIRATION|ACCESS_NOT_GRANTED|INVALID_ACCESS_TOKEN/i.test(message)
}

// Syncs a single plaid_items row: upserts added/modified, deletes removed,
// refreshes balances, and records success/failure on the item. Tells Lia
// only on a status CHANGE (broke / recovered), never on every failed retry.
export async function syncOneItem(service: ServiceClient, item: PlaidItemRow): Promise<ItemSyncResult> {
  const plaid = getPlaidClient()
  let added = 0, modified = 0, removed = 0
  const wasHealthy = (item.status ?? "active") === "active"
  const bankName = item.institution_name ?? "Bank"

  try {
    const { data: accounts, error: acctErr } = await service
      .from("bank_accounts")
      .select("id, plaid_account_id")
      .eq("plaid_item_id", item.id)

    if (acctErr) throw new Error(acctErr.message)
    const accountIdByPlaidId = new Map((accounts ?? []).map((a) => [a.plaid_account_id, a.id]))

    let cursor = item.cursor ?? undefined
    let hasMore = true

    while (hasMore) {
      const { data } = await withRetry(() => plaid.transactionsSync({
        access_token: item.access_token,
        cursor,
        count: 250,
      }))

      for (const tx of data.added) {
        const bankAccountId = accountIdByPlaidId.get(tx.account_id)
        if (!bankAccountId) continue // account not synced locally (e.g. an investment account we skip)
        const { error } = await service.from("bank_transactions").upsert({
          bank_account_id:      bankAccountId,
          plaid_transaction_id: tx.transaction_id,
          amount:                tx.amount,
          date:                  tx.date,
          name:                  tx.merchant_name || tx.name,
          merchant_name:         tx.merchant_name ?? null,
          category:              tx.personal_finance_category?.primary ?? null,
          pending:               tx.pending,
        }, { onConflict: "plaid_transaction_id" })
        if (!error) added++
      }

      for (const tx of data.modified) {
        const bankAccountId = accountIdByPlaidId.get(tx.account_id)
        if (!bankAccountId) continue
        const { error } = await service.from("bank_transactions")
          .update({
            amount:        tx.amount,
            date:          tx.date,
            name:          tx.merchant_name || tx.name,
            merchant_name: tx.merchant_name ?? null,
            category:      tx.personal_finance_category?.primary ?? null,
            pending:       tx.pending,
          })
          .eq("plaid_transaction_id", tx.transaction_id)
        if (!error) modified++
      }

      for (const tx of data.removed) {
        const { error } = await service.from("bank_transactions")
          .delete()
          .eq("plaid_transaction_id", tx.transaction_id)
        if (!error) removed++
      }

      cursor  = data.next_cursor
      hasMore = data.has_more
    }

    // Refresh balances while we're here — cheap and keeps the accounts list current.
    const { data: acctData } = await withRetry(() => plaid.accountsGet({ access_token: item.access_token }))
    for (const a of acctData.accounts) {
      await service.from("bank_accounts")
        .update({
          current_balance:   a.balances.current ?? null,
          available_balance: a.balances.available ?? null,
        })
        .eq("plaid_account_id", a.account_id)
    }

    await service.from("plaid_items")
      .update({ cursor, last_synced_at: new Date().toISOString(), status: "active", error: null })
      .eq("id", item.id)

    if (!wasHealthy) {
      await notifyLiaAction({ text: `✅ ${bankName} bank connection is back online and syncing again.` })
    }

    return { item_id: item.id, institution_name: item.institution_name, added, modified, removed }
  } catch (err) {
    const message = plaidErrorMessage(err)
    console.error(`[bank-sync] item ${item.id} failed:`, message)
    await service.from("plaid_items").update({ status: "error", error: message }).eq("id", item.id)

    if (wasHealthy) {
      await notifyLiaAction({
        text: needsReconnect(message)
          ? `⚠️ ${bankName} needs to be reconnected (${message}). Open the Bank page in the CRM and reconnect — until then no new transactions will come in.`
          : `⚠️ ${bankName} sync failed (${message}). I'll keep retrying automatically — you'll hear from me when it's back.`,
      })
    }

    return { item_id: item.id, institution_name: item.institution_name, added, modified, removed, error: message }
  }
}

// Syncs every non-revoked plaid_items row — including ones currently in
// "error", so a transient failure recovers on its own on the next run.
export async function syncAllItems(service: ServiceClient): Promise<{ results: ItemSyncResult[] }> {
  const { data: items, error: itemsErr } = await service
    .from("plaid_items")
    .select("id, access_token, institution_name, cursor, status")
    .neq("status", "revoked")

  if (itemsErr) throw new Error(itemsErr.message)

  const results: ItemSyncResult[] = []
  for (const item of (items ?? []) as PlaidItemRow[]) {
    results.push(await syncOneItem(service, item))
  }
  return { results }
}
