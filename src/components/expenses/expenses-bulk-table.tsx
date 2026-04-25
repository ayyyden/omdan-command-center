"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { BulkBar, HeaderCheckbox } from "@/components/shared/bulk-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { useSelection } from "@/hooks/use-selection"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { Receipt } from "lucide-react"
import Link from "next/link"

const CAT_LABEL = (c: string) =>
  c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

interface ExpenseRow {
  id: string
  description: string
  expense_type: string
  category: string
  amount: number
  date: string
  job?: { id: string; title: string } | null
}

interface Props {
  expenses: ExpenseRow[]
  userId: string
}

export function ExpensesBulkTable({ expenses, userId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const allIds = expenses.map((e) => e.id)
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const supabase = createClient()
    const ids = Array.from(selected)
    const { error } = await supabase.from("expenses").delete().in("id", ids)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Deleted ${ids.length} expense${ids.length !== 1 ? "s" : ""}` })
    clear()
    setConfirmOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <BulkBar
        count={selected.size}
        entity="expense"
        onDelete={() => setConfirmOpen(true)}
        onClear={clear}
        deleting={deleting}
      />

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 px-3">
                <HeaderCheckbox allSelected={allSelected} someSelected={someSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Job / Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Date</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <Receipt className="w-8 h-8 text-muted-foreground/40" />
                    <div>
                      <p className="font-medium text-muted-foreground">No expenses found</p>
                      <p className="text-sm text-muted-foreground/60 mt-0.5">Try adjusting your filters, or add a new expense.</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              expenses.map((exp) => (
                <TableRow key={exp.id} className={selected.has(exp.id) ? "bg-primary/5" : ""}>
                  <TableCell className="px-3">
                    <input
                      type="checkbox"
                      checked={selected.has(exp.id)}
                      onChange={(e) => toggle(exp.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </TableCell>
                  <TableCell className="font-medium">{exp.description}</TableCell>
                  <TableCell className="text-sm">
                    {exp.expense_type === "business" ? (
                      <Badge variant="outline" className="text-xs">Business</Badge>
                    ) : exp.job ? (
                      <Link href={`/jobs/${exp.job.id}`} className="hover:text-primary">
                        {exp.job.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {CAT_LABEL(exp.category)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-semibold text-destructive">
                    {formatCurrency(Number(exp.amount))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDate(exp.date)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        count={selected.size}
        entity="expense"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        deleting={deleting}
      />
    </div>
  )
}
