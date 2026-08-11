import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"

// Plaid personal_finance_category.primary values that represent money moving
// between the user's own accounts / debt, not a real purchase — never worth
// auto-drafting as an "expense" (see https://plaid.com/documents/pfc-taxonomy-all.csv).
const NON_EXPENSE_CATEGORIES = new Set([
  "INCOME", "TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS", "LOAN_DISBURSEMENTS",
])

// Best-effort guess from Plaid's category taxonomy to this CRM's expense
// category enum — just a starting point, the user can correct it on the
// approval card before approving.
const CATEGORY_MAP: Record<string, string> = {
  FOOD_AND_DRINK:             "meals",
  TRANSPORTATION:             "gas",
  TRAVEL:                     "travel",
  HOME_IMPROVEMENT:           "materials",
  GENERAL_SERVICES:           "subcontractors",
  RENT_AND_UTILITIES:         "office_rent",
  GOVERNMENT_AND_NON_PROFIT:  "permits",
}

function guessExpenseCategory(plaidPrimary: string | null): string {
  if (!plaidPrimary) return "misc"
  return CATEGORY_MAP[plaidPrimary] ?? "misc"
}

interface DraftCandidate {
  bankTransactionId: string
  amount:            number
  vendor:            string
  date:              string
  category:          string
}

// POST /api/bank/sync
// Cursor-based incremental sync for every active plaid_items row. Safe to
// call repeatedly (manual "Sync now" button, or a future cron) — each item's
// cursor picks up exactly where the last sync left off.
//
// New charges found on a sync that already had a cursor (i.e. not the first
// import of a newly connected account) get an auto-drafted create_expense
// approval card in the requesting user's Lia chat — never posted without
// their approval, just pre-filled so they don't have to ask for it.
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
  const draftCandidates: DraftCandidate[] = []

  for (const item of items ?? []) {
    let added = 0, modified = 0, removed = 0
    const isInitialSync = !item.cursor // first-ever sync pulls months of history — never auto-draft that backfill
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
          const plaidPrimary = tx.personal_finance_category?.primary ?? null
          const { data: inserted, error } = await service.from("bank_transactions").upsert({
            bank_account_id:      bankAccountId,
            plaid_transaction_id: tx.transaction_id,
            amount:                tx.amount,
            date:                  tx.date,
            name:                  tx.merchant_name || tx.name,
            merchant_name:         tx.merchant_name ?? null,
            category:              plaidPrimary,
            pending:               tx.pending,
          }, { onConflict: "plaid_transaction_id" })
            .select("id")
            .single()
          if (!error) {
            added++
            const isMoneyOut = tx.amount > 0
            if (!isInitialSync && isMoneyOut && !tx.pending && inserted && !NON_EXPENSE_CATEGORIES.has(plaidPrimary ?? "")) {
              draftCandidates.push({
                bankTransactionId: inserted.id,
                amount:            tx.amount,
                vendor:            tx.merchant_name || tx.name,
                date:              tx.date,
                category:          guessExpenseCategory(plaidPrimary),
              })
            }
          }
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

  let drafted = 0
  if (draftCandidates.length) {
    drafted = await draftExpenseApprovals(service, session.userId, draftCandidates)
  }

  return Response.json({ ok: true, results, drafted })
}

// Finds (or creates) the user's most recent Lia conversation and posts one
// assistant message + pending create_expense approval per new charge — the
// same shape Lia herself produces, so the existing chat UI and approve/
// reject/edit flow just works with no special-casing.
async function draftExpenseApprovals(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  candidates: DraftCandidate[],
): Promise<number> {
  const { data: recentConv } = await service
    .from("assistant_conversations")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .single()

  let conversationId = recentConv?.id as string | undefined
  if (!conversationId) {
    const { data: newConv } = await service
      .from("assistant_conversations")
      .insert({ user_id: userId, title: "Bank activity" })
      .select("id")
      .single()
    conversationId = newConv?.id
  }
  if (!conversationId) return 0

  let drafted = 0
  for (const c of candidates) {
    // Skip if this transaction already has a pending draft (defensive — Plaid
    // shouldn't repeat an id in `added`, but don't double-draft if it does).
    const { data: existing } = await service
      .from("assistant_approvals")
      .select("id")
      .eq("status", "pending")
      .eq("action_type", "create_expense")
      .contains("proposed_payload", { bank_transaction_id: c.bankTransactionId })
      .limit(1)
    if (existing?.length) continue

    const summary = `Log $${c.amount.toFixed(2)} expense — ${c.vendor}`
    const payload = {
      amount:              c.amount,
      vendor:              c.vendor,
      category:            c.category,
      date:                c.date,
      notes:               null,
      job_id:              null,
      bank_transaction_id: c.bankTransactionId,
    }

    const { data: approval } = await service
      .from("assistant_approvals")
      .insert({
        channel:          "crm",
        action_type:      "create_expense",
        action_summary:   summary,
        proposed_payload: payload,
        conversation_id:  conversationId,
        expires_at:       new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id")
      .single()
    if (!approval) continue

    await service.from("assistant_messages").insert({
      conversation_id: conversationId,
      role:            "assistant",
      content:         `New card charge — **${c.vendor}** for $${c.amount.toFixed(2)} on ${c.date}. Want me to log this as an expense?`,
      action_id:       approval.id,
      metadata: {
        action: { type: "create_expense", summary, payload, risk_level: "low" },
      },
    })

    drafted++
  }

  if (drafted > 0) {
    await service.from("assistant_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
  }

  return drafted
}
