// Formatting + tap-only editing for the daily bank digest (save_bank_batch).
// The payload shape mirrors BankReviewPayload in the CRM's
// src/lib/bank-review.ts — keep the two in sync.

import type { InlineKeyboardButton } from "./telegram-client"
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from "./expense-categories"

export interface BankReviewItem {
  bank_transaction_id: string
  date:          string
  amount:        number
  direction:     "out" | "in"
  bank_name:     string
  account:       string
  kind:          "expense" | "payment" | "skip"
  description:   string
  category:      string | null
  job_id:        string | null
  job_title:     string | null
  customer_id:   string | null
  customer_name: string | null
  method:        string | null
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

function shortDate(d: string): string {
  const [, m, day] = d.split("-")
  return `${Number(m)}/${Number(day)}`
}

function money(n: number): string {
  return `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function outcomeLine(it: BankReviewItem): string {
  if (it.kind === "skip") return "⏭ Skip — not an expense or payment"
  const where = it.job_title ? `🏠 ${it.job_title}` : (it.kind === "payment" ? "❓ no job yet" : "Business")
  if (it.kind === "payment") return `💰 Payment · ${it.method ?? "other"} · ${where}`
  return `🧾 ${expenseCategoryLabel(it.category ?? "misc")} · ${where}`
}

export function isUnresolved(it: BankReviewItem): boolean {
  return it.kind === "payment" && !it.job_id
}

export function formatBankDigest(payload: BankReviewPayload, header?: string): string {
  const lines: string[] = []
  if (header) lines.push(header, "")
  payload.items.forEach((it, i) => {
    const flag = it.confidence === "low" || isUnresolved(it) ? "❓ " : ""
    const arrow = it.direction === "in" ? "⬅️ IN" : "OUT"
    lines.push(`${flag}${i + 1}. ${shortDate(it.date)} · ${arrow} ${money(it.amount)} · ${it.description}`)
    lines.push(`    ${outcomeLine(it)}`)
    if (it.question && (it.confidence === "low" || isUnresolved(it))) lines.push(`    ↳ ${it.question}`)
  })
  const unresolved = payload.items.filter(isUnresolved).length
  lines.push("")
  lines.push(unresolved
    ? `Save All saves everything except the ${unresolved} payment${unresolved !== 1 ? "s" : ""} with no job — fix ${unresolved !== 1 ? "those" : "that one"} first, or I'll ask again tomorrow.`
    : "Look right? Save All files everything above.")
  return lines.join("\n")
}

export function bankDigestButtons(approvalId: string): InlineKeyboardButton[][] {
  return [
    [
      { text: "✅ Save All", callback_data: `approve:${approvalId}` },
      { text: "✏️ Fix",      callback_data: `bk_edit:${approvalId}` },
    ],
    [
      { text: "⏭ Later",     callback_data: `bk_later:${approvalId}` },
    ],
  ]
}

export function bankPickButtons(payload: BankReviewPayload): InlineKeyboardButton[][] {
  const rows = payload.items.map((it, i) => [{
    text: `${it.confidence === "low" || isUnresolved(it) ? "❓ " : ""}${i + 1}. ${money(it.amount)} ${it.description}`.slice(0, 60),
    callback_data: `bk_pick:${i}`,
  }])
  const questions = payload.items.filter((it) => it.confidence === "low" || isUnresolved(it)).length
  if (questions > 1) rows.push([{ text: `⏭ Skip all ${questions} ❓ lines (personal / not business)`, callback_data: "bk_skipq" }])
  rows.push([{ text: "◀️ Back", callback_data: "bk_back" }])
  return rows
}

// "These are all personal" in one tap — e.g. a trip's worth of charges.
export function skipAllQuestions(payload: BankReviewPayload): number {
  let n = 0
  payload.items = payload.items.map((it) => {
    if (it.confidence !== "low" && !isUnresolved(it)) return it
    n++
    return { ...it, kind: "skip", confidence: "high", question: null }
  })
  return n
}

export function bankFieldButtons(it: BankReviewItem): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [
    [
      { text: "🧾 Expense", callback_data: "bk_type:expense" },
      { text: "💰 Payment", callback_data: "bk_type:payment" },
      { text: "⏭ Skip",    callback_data: "bk_type:skip" },
    ],
  ]
  if (it.kind === "expense") rows.push([{ text: "🏷 Change category", callback_data: "bk_field:cat" }])
  if (it.kind !== "skip")    rows.push([{ text: "🏠 Change job", callback_data: "bk_field:job" }])
  rows.push([{ text: "◀️ Back", callback_data: "bk_back" }])
  return rows
}

export function bankCategoryButtons(): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = []
  for (let i = 0; i < EXPENSE_CATEGORIES.length; i += 2) {
    const row = [{ text: expenseCategoryLabel(EXPENSE_CATEGORIES[i]), callback_data: `bk_cat:${i}` }]
    if (EXPENSE_CATEGORIES[i + 1]) row.push({ text: expenseCategoryLabel(EXPENSE_CATEGORIES[i + 1]), callback_data: `bk_cat:${i + 1}` })
    rows.push(row)
  }
  rows.push([{ text: "◀️ Back", callback_data: "bk_back" }])
  return rows
}

export function bankJobButtons(payload: BankReviewPayload, it: BankReviewItem): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = payload.job_options.map((j, i) => [{
    text: `${j.title} — ${j.customer_name}`.slice(0, 60),
    callback_data: `bk_job:${i}`,
  }])
  if (it.kind === "expense") rows.unshift([{ text: "🏢 General business (no job)", callback_data: "bk_job:none" }])
  rows.push([{ text: "◀️ Back", callback_data: "bk_back" }])
  return rows
}

// ── Edits — each returns the updated item; the caller persists the payload. ──
// An explicit choice by the owner counts as confirmed, so the ❓ clears
// unless it's a payment that still has no job.

function confirmed(it: BankReviewItem): BankReviewItem {
  const unresolved = isUnresolved(it)
  return {
    ...it,
    confidence: unresolved ? "low" : "high",
    question:   unresolved ? "Which job is this payment for?" : null,
  }
}

export function setKind(it: BankReviewItem, kind: BankReviewItem["kind"], payload: BankReviewPayload): BankReviewItem {
  if (kind === "skip") return confirmed({ ...it, kind })
  if (kind === "expense") {
    return confirmed({ ...it, kind, category: it.category ?? "misc", customer_id: null, customer_name: null, method: null })
  }
  const job = it.job_id ? payload.job_options.find((j) => j.id === it.job_id) : undefined
  return confirmed({
    ...it, kind, category: null, method: it.method ?? (it.direction === "in" ? "check" : "other"),
    customer_id: job?.customer_id ?? null, customer_name: job?.customer_name ?? null,
  })
}

export function setCategory(it: BankReviewItem, categoryIndex: number): BankReviewItem | null {
  const category = EXPENSE_CATEGORIES[categoryIndex]
  if (!category) return null
  return confirmed({ ...it, kind: "expense", category, customer_id: null, customer_name: null, method: null })
}

export function setJob(it: BankReviewItem, jobIndex: number | "none", payload: BankReviewPayload): BankReviewItem | null {
  if (jobIndex === "none") {
    return confirmed({ ...it, job_id: null, job_title: null, customer_id: null, customer_name: null })
  }
  const job = payload.job_options[jobIndex]
  if (!job) return null
  return confirmed({
    ...it, job_id: job.id, job_title: job.title,
    customer_id: it.kind === "payment" ? job.customer_id : null,
    customer_name: it.kind === "payment" ? job.customer_name : null,
  })
}
