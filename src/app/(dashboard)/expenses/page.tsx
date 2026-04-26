import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { formatCurrency } from "@/lib/utils"
import { AddExpenseDialog } from "@/components/expenses/add-expense-dialog"
import { ExpensesFilters } from "./expenses-filters"
import { ExpensesBulkTable } from "@/components/expenses/expenses-bulk-table"
import { ReceiptsSection } from "@/components/receipts/receipts-section"

const CAT_LABEL = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

interface PageProps {
  searchParams: Promise<{ type?: string; category?: string; from?: string; to?: string }>
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  const { type, category, from, to } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  let q = supabase
    .from("expenses")
    .select("*, job:jobs(id, title)")
    .eq("user_id", user.id)
    .order("date", { ascending: false })

  if (type === "job")      q = q.eq("expense_type", "job")
  if (type === "business") q = q.eq("expense_type", "business")
  if (category && category !== "all") q = q.eq("category", category)
  if (from) q = q.gte("date", from)
  if (to)   q = q.lte("date", to)

  const { data: expenses } = await q

  const rows  = expenses ?? []
  const total = rows.reduce((sum, e) => sum + Number(e.amount), 0)

  const typeLabel =
    type === "job"      ? " · Job Expenses" :
    type === "business" ? " · Business Expenses" : ""

  return (
    <div>
      <Topbar
        title="Expenses"
        subtitle={`${rows.length} expense${rows.length !== 1 ? "s" : ""}${typeLabel} · ${formatCurrency(total)}`}
        actions={<AddExpenseDialog userId={user.id} />}
      />

      <div className="p-4 sm:p-6 space-y-4">
        <ExpensesFilters
          currentType={type ?? "all"}
          currentCategory={category ?? "all"}
          currentFrom={from ?? ""}
          currentTo={to ?? ""}
        />

        {/* Filtered total */}
        <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {rows.length} expense{rows.length !== 1 ? "s" : ""}
            {type === "job" ? " (job)" : type === "business" ? " (business)" : ""}
            {category && category !== "all" ? ` · ${CAT_LABEL(category)}` : ""}
            {(from || to) ? ` · ${from ?? "…"} → ${to ?? "…"}` : ""}
          </span>
          <span className="text-lg font-bold text-destructive">{formatCurrency(total)}</span>
        </div>

        <ExpensesBulkTable expenses={rows as any[]} userId={user.id} />
        <ReceiptsSection userId={user.id} />
      </div>
    </div>
  )
}
