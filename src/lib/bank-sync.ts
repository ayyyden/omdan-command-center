// Core Plaid transaction sync logic — shared by the manual "Sync now" button,
// the scheduled cron fallback, and the SYNC_UPDATES_AVAILABLE webhook (the
// primary trigger now; the other two exist as safety nets in case a webhook
// is ever missed).
//
// New charges found on a sync that already had a cursor (i.e. not the first
// import of a newly connected account) get surfaced in the target user's Lia
// chat + Telegram:
//   - money OUT  → an auto-drafted create_expense approval card (job_id left
//     blank — which job a charge belongs to isn't knowable from bank data
//     alone; edit the card or tell Lia in chat and she'll attach one)
//   - money IN   → a plain question asking which job/customer paid it,
//     since record_payment requires a job_id + customer_id (no valid data to
//     pre-fill), unlike create_expense
// Either way: never auto-posts anything without a human approving it.

import { createServiceClient } from "@/lib/supabase/service"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"
import { notifyLiaAction } from "@/lib/lia-notifications"

type ServiceClient = ReturnType<typeof createServiceClient>

// Plaid personal_finance_category.primary values that represent money moving
// between the user's own accounts / debt, not a real purchase or payment —
// never worth surfacing as an expense or payment
// (see https://plaid.com/documents/pfc-taxonomy-all.csv).
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

interface TxCandidate {
  bankTransactionId: string
  amount:            number  // absolute value
  name:              string
  date:              string
  category:          string | null
}

export interface PlaidItemRow {
  id:                string
  access_token:      string
  institution_name:  string | null
  cursor:            string | null
}

export interface ItemSyncResult {
  item_id: string
  institution_name: string | null
  added: number
  modified: number
  removed: number
  error?: string
}

// Syncs a single plaid_items row and returns the raw counts — does NOT
// draft/notify by itself; candidates are collected so callers can batch
// draftBankActivity() across multiple items (the full-sweep case) or call it
// for just the one item a webhook fired for.
export async function syncOneItem(
  service: ServiceClient,
  item: PlaidItemRow,
): Promise<{ result: ItemSyncResult; expenseCandidates: TxCandidate[]; depositCandidates: TxCandidate[] }> {
  const plaid = getPlaidClient()
  let added = 0, modified = 0, removed = 0
  const expenseCandidates: TxCandidate[] = []
  const depositCandidates: TxCandidate[] = []
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
          const eligible = !isInitialSync && !tx.pending && inserted && !NON_EXPENSE_CATEGORIES.has(plaidPrimary ?? "")
          if (eligible) {
            const candidate: TxCandidate = {
              bankTransactionId: inserted.id,
              amount:            Math.abs(tx.amount),
              name:              tx.merchant_name || tx.name,
              date:              tx.date,
              category:          plaidPrimary,
            }
            if (tx.amount > 0) expenseCandidates.push(candidate)
            else               depositCandidates.push(candidate)
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

    return {
      result: { item_id: item.id, institution_name: item.institution_name, added, modified, removed },
      expenseCandidates, depositCandidates,
    }
  } catch (err) {
    const message = plaidErrorMessage(err)
    console.error(`[bank-sync] item ${item.id} failed:`, message)
    await service.from("plaid_items").update({ status: "error", error: message }).eq("id", item.id)
    return {
      result: { item_id: item.id, institution_name: item.institution_name, added, modified, removed, error: message },
      expenseCandidates, depositCandidates,
    }
  }
}

// Syncs every active plaid_items row (the manual button + cron fallback path).
export async function syncAllActiveItems(
  service: ServiceClient,
  syncUserId: string,
): Promise<{ results: ItemSyncResult[]; drafted: number; flagged: number; autoIgnored: number }> {
  const { data: items, error: itemsErr } = await service
    .from("plaid_items")
    .select("id, access_token, institution_name, cursor")
    .eq("status", "active")

  if (itemsErr) throw new Error(itemsErr.message)

  const results: ItemSyncResult[] = []
  const allExpenseCandidates: TxCandidate[] = []
  const allDepositCandidates: TxCandidate[] = []

  for (const item of (items ?? []) as PlaidItemRow[]) {
    const { result, expenseCandidates, depositCandidates } = await syncOneItem(service, item)
    results.push(result)
    allExpenseCandidates.push(...expenseCandidates)
    allDepositCandidates.push(...depositCandidates)
  }

  let drafted = 0, flagged = 0, autoIgnored = 0
  if (allExpenseCandidates.length || allDepositCandidates.length) {
    const summary = await draftBankActivity(service, syncUserId, allExpenseCandidates, allDepositCandidates)
    drafted = summary.drafted
    flagged = summary.flagged
    autoIgnored = summary.autoIgnored
  }

  return { results, drafted, flagged, autoIgnored }
}

// A same-amount record within a few days of the bank transaction's date is
// very likely the same real-world purchase/payment already logged some
// other way (manual entry, a different sync run, etc.) — skip re-proposing
// it and just mark the bank row ignored instead of creating a duplicate.
async function hasLikelyDuplicate(
  service: ServiceClient,
  table: "expenses" | "payments",
  amount: number,
  date: string,
): Promise<boolean> {
  const center = new Date(`${date}T00:00:00Z`)
  const from = new Date(center); from.setUTCDate(from.getUTCDate() - 3)
  const to   = new Date(center); to.setUTCDate(to.getUTCDate() + 3)
  const { data } = await service
    .from(table)
    .select("id")
    .eq("amount", amount)
    .gte("date", from.toISOString().split("T")[0])
    .lte("date", to.toISOString().split("T")[0])
    .limit(1)
  return !!data?.length
}

// Finds (or creates) the user's most recent Lia conversation and, per new
// transaction: drafts a create_expense approval (money out), asks a plain
// question (money in — record_payment needs a job_id + customer_id we can't
// guess), or — if a likely-duplicate record already exists — skips both and
// marks the bank row "ignored" instead.
export async function draftBankActivity(
  service: ServiceClient,
  userId: string,
  expenseCandidates: TxCandidate[],
  depositCandidates: TxCandidate[],
): Promise<{ drafted: number; flagged: number; autoIgnored: number }> {
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
  if (!conversationId) return { drafted: 0, flagged: 0, autoIgnored: 0 }

  let drafted = 0
  let flagged = 0
  let autoIgnored = 0

  for (const c of expenseCandidates) {
    if (await hasLikelyDuplicate(service, "expenses", c.amount, c.date)) {
      await service.from("bank_transactions").update({ match_status: "ignored" }).eq("id", c.bankTransactionId)
      autoIgnored++
      continue
    }

    const summary = `Log $${c.amount.toFixed(2)} expense — ${c.name}`
    const payload = {
      amount: c.amount, vendor: c.name, category: guessExpenseCategory(c.category), date: c.date,
      notes: null, job_id: null, bank_transaction_id: c.bankTransactionId,
    }

    const { data: approval } = await service
      .from("assistant_approvals")
      .insert({
        channel: "crm", action_type: "create_expense", action_summary: summary, proposed_payload: payload,
        conversation_id: conversationId, expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select("id").single()
    if (!approval) continue

    const messageText = `New card charge — **${c.name}** for $${c.amount.toFixed(2)} on ${c.date}. Want me to log this as an expense? (Left as a business expense — tell me which job if it belongs to one.)`

    await service.from("assistant_messages").insert({
      conversation_id: conversationId, role: "assistant",
      content: messageText,
      action_id: approval.id,
      metadata: { action: { type: "create_expense", summary, payload, risk_level: "low" } },
    })
    notifyLiaAction({
      text: messageText, approvalId: approval.id,
      actionType: "create_expense", actionSummary: summary, payload,
    })
    drafted++
  }

  for (const c of depositCandidates) {
    if (await hasLikelyDuplicate(service, "payments", c.amount, c.date)) {
      await service.from("bank_transactions").update({ match_status: "ignored" }).eq("id", c.bankTransactionId)
      autoIgnored++
      continue
    }

    // No approval card here — record_payment requires job_id + customer_id,
    // and there's no reliable way to guess either from bank data alone.
    // Asking in chat lets Lia resolve it conversationally (she can look the
    // transaction back up via list_bank_transactions and propose
    // record_payment with bank_transaction_id once told which job it's for).
    const messageText = `💰 New deposit — $${c.amount.toFixed(2)} from ${c.name} on ${c.date}. Which job (or customer) is this a payment for? Tell me and I'll record it.`

    await service.from("assistant_messages").insert({
      conversation_id: conversationId, role: "assistant",
      content: messageText,
    })
    notifyLiaAction({ text: messageText })
    await service.from("bank_transactions").update({ match_status: "suggested" }).eq("id", c.bankTransactionId)
    flagged++
  }

  if (drafted > 0 || flagged > 0) {
    await service.from("assistant_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId)
  }

  return { drafted, flagged, autoIgnored }
}
