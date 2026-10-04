// Daily bank-transaction review: turns raw Plaid transactions into a
// one-tap Lia digest.
//
//   1. Collect transactions nobody has dealt with yet (unmatched/suggested,
//      posted, last 60 days, not already sitting in an open digest).
//   2. Link anything that's already recorded (same amount, close date, a
//      record no other bank transaction claims) — no duplicates, ever.
//   3. Ask Claude to sort the rest: expense vs customer payment vs skip
//      (card payoffs / transfers / refunds), business-general vs which job,
//      what it actually was, and the category — grounded in how past
//      transactions from the same payee were filed (learned history), not
//      hardcoded guesses.
//   4. Send Lia ONE Telegram message per batch with ✅ Save All / ✏️ Fix /
//      ⏭ Later. Saving is executed by the "save_bank_batch" handler in
//      /api/assistant/execute/[id]; Fix is a tap-only flow in lia-bridge.
//
// Nothing is written to expenses/payments without that tap — same
// approval-first rule as every other money-moving action in this CRM.

import Anthropic from "@anthropic-ai/sdk"
import { createServiceClient } from "@/lib/supabase/service"
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_HINTS, expenseCategoryLabel } from "@/lib/expense-categories"
import { notifyLiaAction } from "@/lib/lia-notifications"
import { getTodayLA, addDaysLA } from "@/lib/utils"

type ServiceClient = ReturnType<typeof createServiceClient>

const PAYMENT_METHODS = ["cash", "check", "zelle", "venmo", "credit_card", "bank_transfer", "other"] as const

const LOOKBACK_DAYS    = 60  // older unmatched history is handled manually, never flooded into Telegram
const MAX_PER_RUN      = 45
const BATCH_SIZE       = 15  // keeps each Telegram message well under the 4096-char limit
const DIGEST_TTL_DAYS  = 7   // an ignored digest expires and its items are re-proposed

export interface BankReviewItem {
  bank_transaction_id: string
  date:          string
  amount:        number            // always positive
  direction:     "out" | "in"
  bank_name:     string
  account:       string            // "Card ••9224" / "Checking ••8835"
  kind:          "expense" | "payment" | "skip"
  description:   string
  category:      string | null     // expenses only
  job_id:        string | null
  job_title:     string | null
  customer_id:   string | null
  customer_name: string | null
  method:        string | null     // payments only
  confidence:    "high" | "medium" | "low"
  question:      string | null
}

export interface JobOption {
  id:            string
  title:         string
  customer_id:   string
  customer_name: string
}

export interface BankReviewPayload {
  items:       BankReviewItem[]
  job_options: JobOption[]
}

export interface BankReviewResult {
  considered:  number
  auto_linked: number
  proposed:    number
  batches:     number
}

interface Candidate {
  id:        string
  date:      string
  amount:    number   // signed, Plaid convention: + = money out
  name:      string
  category:  string | null
  account:   string
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Math.round((new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86400000))
}

function normalizeName(s: string): string {
  // Strip ACH noise (trace numbers, ids, dates) so "GUSTO ... TRACE#:0210..."
  // from different months collapses to one learned payee.
  return s
    .replace(/ORIG CO NAME:/i, "")
    .replace(/(ORIG ID|DESC DATE|CO ENTRY DESCR|SEC|TRACE#|EED|IND ID|IND NAME|TRN):?\s*\S*/gi, " ")
    .replace(/\d{4,}/g, " ")
    .replace(/[^a-z ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 40)
}

// ─── Step 1 + 2: candidates and auto-linking ─────────────────────────────────

export interface BankReviewOptions {
  /** Classify and return items without creating a digest or messaging anyone. */
  dryRun?: boolean
  /** Override the default 60-day lookback (backlog cleanup). */
  since?: string
  until?: string
  limit?: number
}

async function loadCandidates(service: ServiceClient, opts: BankReviewOptions): Promise<Candidate[]> {
  const since = opts.since ?? addDaysLA(getTodayLA(), -LOOKBACK_DAYS)
  const until = opts.until ?? getTodayLA()
  const limit = opts.limit ?? MAX_PER_RUN

  const { data: openDigests } = await service
    .from("assistant_approvals")
    .select("proposed_payload")
    .eq("action_type", "save_bank_batch")
    .in("status", ["pending", "edited"])
    .gt("expires_at", new Date().toISOString())
  const inFlight = new Set<string>()
  for (const d of openDigests ?? []) {
    for (const it of ((d.proposed_payload as BankReviewPayload)?.items ?? [])) inFlight.add(it.bank_transaction_id)
  }

  const { data, error } = await service
    .from("bank_transactions")
    .select("id, date, amount, name, category, bank_account:bank_accounts(name, mask, type)")
    .in("match_status", ["unmatched", "suggested"])
    .eq("pending", false)
    .gte("date", since)
    .lte("date", until)
    .order("date", { ascending: true })
    .limit(limit * 2)
  if (error) throw new Error(error.message)

  return (data ?? [])
    .filter((t) => !inFlight.has(t.id))
    .map((t) => {
      const acct = t.bank_account as unknown as { mask: string | null; type: string | null } | null
      const label = acct?.type === "credit" ? "Card" : "Checking"
      return {
        id: t.id, date: t.date, amount: Number(t.amount), name: t.name, category: t.category,
        account: `${label} ••${acct?.mask ?? "?"}`,
      }
    })
}

// Same amount, close date, and a record no other bank transaction already
// claims → it's the same real-world money movement, just logged another way
// (screenshot, manual entry). Checks can take weeks to clear, so large
// amounts get a wider window. Exact-date matches win over nearby ones so a
// recurring same-amount charge (daily $188 ads) never grabs its neighbor.
async function autoLinkExisting(
  service: ServiceClient,
  candidates: Candidate[],
  persist: boolean,
): Promise<{ remaining: Candidate[]; linked: number }> {
  if (!candidates.length) return { remaining: [], linked: 0 }
  const minDate = addDaysLA(candidates[0].date, -25)
  const maxDate = addDaysLA(candidates[candidates.length - 1].date, 25)

  const [{ data: expenses }, { data: payments }, { data: claimedExp }, { data: claimedPay }] = await Promise.all([
    service.from("expenses").select("id, amount, date").gte("date", minDate).lte("date", maxDate),
    service.from("payments").select("id, amount, date").gte("date", minDate).lte("date", maxDate),
    service.from("bank_transactions").select("matched_expense_id").not("matched_expense_id", "is", null),
    service.from("bank_transactions").select("matched_payment_id").not("matched_payment_id", "is", null),
  ])
  const claimed = new Set<string>([
    ...(claimedExp ?? []).map((r) => r.matched_expense_id as string),
    ...(claimedPay ?? []).map((r) => r.matched_payment_id as string),
  ])

  const remaining: Candidate[] = []
  let linked = 0
  for (const c of candidates) {
    const abs = Math.abs(c.amount)
    const pool = c.amount > 0 ? (expenses ?? []) : (payments ?? [])
    const window = abs >= 1000 ? 25 : 4
    const match = pool
      .filter((r) => !claimed.has(r.id) && Math.abs(Number(r.amount) - abs) < 0.005 && daysBetween(r.date, c.date) <= window)
      .sort((a, b) => daysBetween(a.date, c.date) - daysBetween(b.date, c.date))[0]

    if (match) {
      claimed.add(match.id)
      // A dry run must be side-effect free — two overlapping dry runs once
      // both "linked" different charges to the same logged expense.
      if (persist) await service.from("bank_transactions")
        .update(c.amount > 0
          ? { match_status: "confirmed", matched_expense_id: match.id }
          : { match_status: "confirmed", matched_payment_id: match.id })
        .eq("id", c.id)
      linked++
    } else {
      remaining.push(c)
    }
  }
  return { remaining, linked }
}

// ─── Step 3: context + Claude ────────────────────────────────────────────────

async function buildContext(service: ServiceClient): Promise<{ jobs: JobOption[]; jobLines: string; history: string }> {
  const [{ data: jobRows }, { data: payRows }, { data: confirmed }, { data: ignored }, { data: recentExp }] = await Promise.all([
    service.from("jobs")
      .select("id, title, status, scheduled_date, completion_date, customer:customers(id, name)")
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(40),
    service.from("payments").select("job_id, amount, date, method"),
    service.from("bank_transactions")
      .select("name, amount, matched_expense:expenses!bank_transactions_matched_expense_id_fkey(category, description, job_id), matched_payment:payments!bank_transactions_matched_payment_id_fkey(job_id, method)")
      .eq("match_status", "confirmed")
      .order("date", { ascending: false })
      .limit(500),
    service.from("bank_transactions").select("name").eq("match_status", "ignored").order("date", { ascending: false }).limit(200),
    service.from("expenses").select("description, category, job_id").order("date", { ascending: false }).limit(300),
  ])

  const jobs: JobOption[] = (jobRows ?? []).map((j) => {
    const cust = j.customer as unknown as { id: string; name: string } | null
    return { id: j.id, title: j.title, customer_id: cust?.id ?? "", customer_name: cust?.name ?? "" }
  }).filter((j) => j.customer_id)
  const jobTitle = new Map(jobs.map((j) => [j.id, j.title]))

  const paidByJob = new Map<string, string[]>()
  for (const p of payRows ?? []) {
    const list = paidByJob.get(p.job_id) ?? []
    list.push(`$${Number(p.amount).toFixed(2)} ${p.method} ${p.date}`)
    paidByJob.set(p.job_id, list)
  }
  const jobLines = (jobRows ?? []).map((j) => {
    const cust = j.customer as unknown as { id: string; name: string } | null
    const paid = paidByJob.get(j.id) ?? []
    return `- job_id=${j.id} | ${j.title} | customer: ${cust?.name ?? "?"} (customer_id=${cust?.id ?? "?"}) | status: ${j.status} | scheduled: ${j.scheduled_date ?? "?"} | completed: ${j.completion_date ?? "-"} | payments so far: ${paid.length ? paid.join(", ") : "none"}`
  }).join("\n")

  // Learned history: how each bank payee was actually filed before.
  const learned = new Map<string, Map<string, number>>()
  const bump = (name: string, outcome: string) => {
    const key = normalizeName(name)
    if (!key) return
    const m = learned.get(key) ?? new Map<string, number>()
    m.set(outcome, (m.get(outcome) ?? 0) + 1)
    learned.set(key, m)
  }
  for (const t of confirmed ?? []) {
    const exp = t.matched_expense as unknown as { category: string; description: string; job_id: string | null } | null
    const pay = t.matched_payment as unknown as { job_id: string; method: string } | null
    if (exp) bump(t.name, `expense · ${exp.category} · ${exp.job_id ? `job "${jobTitle.get(exp.job_id) ?? exp.job_id}"` : "business"} · "${exp.description}"`)
    else if (pay) bump(t.name, `payment · ${pay.method} · job "${jobTitle.get(pay.job_id) ?? pay.job_id}"`)
  }
  for (const t of ignored ?? []) bump(t.name, "skip (not a business expense/payment — e.g. card payoff or transfer)")

  // Manually-entered expenses (not from the bank feed) are history too.
  const manual = new Map<string, Map<string, number>>()
  for (const e of recentExp ?? []) {
    const key = normalizeName(e.description ?? "")
    if (!key) continue
    const outcome = `${e.category} · ${e.job_id ? `job "${jobTitle.get(e.job_id) ?? e.job_id}"` : "business"}`
    const m = manual.get(key) ?? new Map<string, number>()
    m.set(outcome, (m.get(outcome) ?? 0) + 1)
    manual.set(key, m)
  }

  const fmt = (map: Map<string, Map<string, number>>) => [...map.entries()]
    .map(([k, outcomes]) => `- "${k}" → ${[...outcomes.entries()].sort((a, b) => b[1] - a[1]).map(([o, n]) => `${o} (×${n})`).join("; ")}`)
    .slice(0, 150)
    .join("\n")

  const history = `BANK PAYEES — how they were filed before:\n${fmt(learned) || "(none yet)"}\n\nOTHER RECENT EXPENSES — description → category · job:\n${fmt(manual) || "(none yet)"}`
  return { jobs, jobLines, history }
}

const SYSTEM_PROMPT = `You are the bookkeeper for Omdan Development, a residential construction / landscaping contractor in Southern California. You sort the owner's bank transactions so each one lands in the CRM correctly. Accounts are the business checking account and the business credit card.

For EACH transaction decide:
1. kind:
   - "expense": real money spent on the business.
   - "payment": money received from a customer for a job (Zelle from a person, mobile/remote check deposit, financing-company funding).
   - "skip": anything that is NOT a business expense or customer payment — paying off our own credit cards ("Payment to Chase card", "CCPYMT", "E-PAYMENT", "DC PYMNTS", "Payment Thank You"), transfers between our own accounts, vendor refunds/credits.
   History beats these generic rules: if a payee was filed a specific way before (e.g. a monthly loan payment filed as a vehicle expense), follow the history.
   PERSONAL SPENDING: the owner sometimes uses the business card/account for personal things — trips and hotels, weddings and events, entertainment, gifts, restaurants or shopping far from the work area (Southern California: the Coachella Valley / Palm Springs area, the Inland Empire, Los Angeles). Never assume those are business. If it's clearly personal (e.g. a wedding planner), use "skip". If it could be either (e.g. a cluster of Las Vegas hotel, restaurant and ride charges), use confidence "low" and ask "Business or personal?" — group related charges by asking the same question on each. Everyday crew food and gas near the work area are business, as the history shows.
2. job_id: set ONLY with real evidence — the payee was filed against that job before, the customer's name appears, or a deposit clearly matches a job's customer/balance. Otherwise null (general business). Never guess a job.
   For a "payment", job_id is required to save it — if you can't tell which job, leave it null, set confidence "low" and ask.
3. customer_id: for payments, the customer of the chosen job (or null).
4. category (expenses only, else "none"), from: ${EXPENSE_CATEGORIES.join(", ")}.
   ${EXPENSE_CATEGORY_HINTS.split("\n").join("\n   ")}
   - Payroll (Gusto NET / TAX) → labor.
5. method (payments only, else "other"): cash, check, zelle, venmo, credit_card, bank_transfer, other. A remote/mobile deposit is "check".
6. description: short, plain English — what it actually was, e.g. "Facebook ads", "Gas — Morongo Travel Center", "Payroll — net pay (Gusto)", "Final payment — Zelle from Brian Barbaro".
7. confidence: "high" when history or the payee makes it obvious; "medium" when it's a sensible guess; "low" when you genuinely don't know.
8. question: when confidence is "low", one short question for the owner (e.g. "Who was check #108 for?"); otherwise null.

Never invent amounts, dates, jobs or customers. Return one result per input transaction, using its index.`

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index:       { type: "integer" },
          kind:        { type: "string", enum: ["expense", "payment", "skip"] },
          job_id:      { type: ["string", "null"] },
          customer_id: { type: ["string", "null"] },
          category:    { type: "string", enum: [...EXPENSE_CATEGORIES, "none"] },
          method:      { type: "string", enum: [...PAYMENT_METHODS] },
          description: { type: "string" },
          confidence:  { type: "string", enum: ["high", "medium", "low"] },
          question:    { type: ["string", "null"] },
        },
        required: ["index", "kind", "job_id", "customer_id", "category", "method", "description", "confidence", "question"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
}

interface RawResult {
  index: number; kind: "expense" | "payment" | "skip"; job_id: string | null; customer_id: string | null
  category: string; method: string; description: string; confidence: "high" | "medium" | "low"; question: string | null
}

export async function classifyTransactions(
  candidates: Candidate[],
  ctx: { jobs: JobOption[]; jobLines: string; history: string },
): Promise<BankReviewItem[]> {
  const client = new Anthropic()
  const txLines = candidates.map((c, i) =>
    `${i}. ${c.date} | ${c.amount > 0 ? "OUT" : "IN"} $${Math.abs(c.amount).toFixed(2)} | ${c.account} | bank says: "${c.name}" | plaid category: ${c.category ?? "-"}`
  ).join("\n")

  const response = await client.messages.stream({
    model:      "claude-opus-5",
    max_tokens: 16000,
    thinking:   { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    system:     SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: `JOBS:\n${ctx.jobLines || "(no jobs)"}\n\n${ctx.history}\n\nTRANSACTIONS TO SORT:\n${txLines}`,
    }],
  }).finalMessage()

  if (response.stop_reason === "refusal") throw new Error("Classifier refused the request")
  const text = response.content.find((b) => b.type === "text")
  if (!text || text.type !== "text") throw new Error("Classifier returned no output")
  const parsed = JSON.parse(text.text) as { results: RawResult[] }

  const jobById = new Map(ctx.jobs.map((j) => [j.id, j]))
  const validCategories = new Set<string>(EXPENSE_CATEGORIES)
  const byIndex = new Map(parsed.results.map((r) => [r.index, r]))

  return candidates.map((c, i): BankReviewItem => {
    const r = byIndex.get(i)
    const direction = c.amount > 0 ? "out" : "in"
    const base = {
      bank_transaction_id: c.id, date: c.date, amount: Math.abs(c.amount), direction,
      bank_name: c.name, account: c.account,
    } as const

    if (!r) {
      return { ...base, kind: direction === "out" ? "expense" : "payment", description: c.name, category: direction === "out" ? "misc" : null,
        job_id: null, job_title: null, customer_id: null, customer_name: null, method: direction === "in" ? "other" : null,
        confidence: "low", question: "I couldn't sort this one — what was it?" }
    }

    // Don't trust ids the model didn't get from us.
    const job = r.job_id ? jobById.get(r.job_id) ?? null : null
    let confidence = r.confidence
    let question = r.question

    if (r.kind === "payment" && !job) {
      confidence = "low"
      question = question ?? "Which job is this payment for?"
    }
    let category: string | null = null
    if (r.kind === "expense") {
      category = validCategories.has(r.category) ? r.category : "misc"
    }

    return {
      ...base,
      kind:          r.kind,
      description:   r.description || c.name,
      category,
      job_id:        job?.id ?? null,
      job_title:     job?.title ?? null,
      customer_id:   r.kind === "payment" ? (job?.customer_id ?? null) : null,
      customer_name: r.kind === "payment" ? (job?.customer_name ?? null) : null,
      method:        r.kind === "payment" ? r.method : null,
      confidence,
      question:      confidence === "low" ? question : null,
    }
  })
}

// ─── Step 4: digest ──────────────────────────────────────────────────────────

export function describeReviewItem(it: BankReviewItem): string {
  if (it.kind === "skip") return `⏭ Skip — ${it.description}`
  const where = it.job_title ? `🏠 ${it.job_title}` : (it.kind === "payment" ? "❓ no job yet" : "Business")
  if (it.kind === "payment") return `💰 Payment · ${it.method ?? "other"} · ${where}`
  return `🧾 ${expenseCategoryLabel(it.category ?? "misc")} · ${where}`
}

export async function runBankReview(
  service: ServiceClient,
  opts: BankReviewOptions = {},
): Promise<BankReviewResult & { items?: BankReviewItem[] }> {
  const all = await loadCandidates(service, opts)
  const { remaining, linked } = await autoLinkExisting(service, all, !opts.dryRun)
  const toSort = remaining.slice(0, opts.limit ?? MAX_PER_RUN)

  if (!toSort.length) return { considered: all.length, auto_linked: linked, proposed: 0, batches: 0, items: [] }

  const ctx = await buildContext(service)
  const items = await classifyTransactions(toSort, ctx)
  if (opts.dryRun) return { considered: all.length, auto_linked: linked, proposed: items.length, batches: 0, items }
  const jobOptions = ctx.jobs.slice(0, 20)

  let batches = 0
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE)
    const payload: BankReviewPayload = { items: chunk, job_options: jobOptions }
    const summary = `Sort ${chunk.length} bank transaction${chunk.length !== 1 ? "s" : ""}`

    const { data: approval, error } = await service
      .from("assistant_approvals")
      .insert({
        channel: "telegram", action_type: "save_bank_batch", action_summary: summary,
        proposed_payload: payload,
        expires_at: new Date(Date.now() + DIGEST_TTL_DAYS * 86400000).toISOString(),
      })
      .select("id")
      .single()
    if (error || !approval) { console.error("[bank-review] failed to create digest approval:", error?.message); continue }

    const unsure = chunk.filter((c) => c.confidence === "low").length
    notifyLiaAction({
      text: `🏦 New bank activity — I sorted ${chunk.length} transaction${chunk.length !== 1 ? "s" : ""}${unsure ? ` (${unsure} need your input ❓)` : ""}.`,
      approvalId: approval.id, actionType: "save_bank_batch", actionSummary: summary,
      payload: payload as unknown as Record<string, unknown>,
    })
    batches++
  }

  return { considered: all.length, auto_linked: linked, proposed: items.length, batches }
}
