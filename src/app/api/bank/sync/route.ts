import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"

// POST /api/bank/sync
// Cursor-based incremental sync for every active plaid_items row. Safe to
// call repeatedly (manual "Sync now" button, or a future cron) — each item's
// cursor picks up exactly where the last sync left off.
export async function POST() {
  const session = await requirePermission("bank:manage")
  if (session instanceof Response) return session

  const plaid   = getPlaidClient()
  const service = createServiceClient()

  const { data: items, error: itemsErr } = await service
    .from("plaid_items")
    .select("id, access_token, institution_name, cursor")
    .eq("status", "active")

  if (itemsErr) {
    return Response.json({ error: itemsErr.message }, { status: 500 })
  }

  const results: Array<{ item_id: string; institution_name: string | null; added: number; modified: number; removed: number; error?: string }> = []

  for (const item of items ?? []) {
    let added = 0, modified = 0, removed = 0
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
        const { data } = await plaid.transactionsSync({
          access_token: item.access_token,
          cursor,
          count: 250,
        })

        for (const tx of data.added) {
          const bankAccountId = accountIdByPlaidId.get(tx.account_id)
          if (!bankAccountId) continue // account not yet synced locally (e.g. investment account we skip)
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
      const { data: acctData } = await plaid.accountsGet({ access_token: item.access_token })
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

      results.push({ item_id: item.id, institution_name: item.institution_name, added, modified, removed })
    } catch (err) {
      const message = plaidErrorMessage(err)
      console.error(`[bank/sync] item ${item.id} failed:`, message)
      await service.from("plaid_items").update({ status: "error", error: message }).eq("id", item.id)
      results.push({ item_id: item.id, institution_name: item.institution_name, added, modified, removed, error: message })
    }
  }

  return Response.json({ ok: true, results })
}
