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
import Link from "next/link"

interface PaymentRow {
  id: string
  amount: number
  method: string
  date: string
  notes: string | null
  job?: { id: string; title: string } | null
  customer?: { id: string; name: string } | null
}

interface Props {
  payments: PaymentRow[]
  userId: string
}

export function PaymentsBulkTable({ payments, userId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const allIds = payments.map((p) => p.id)
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const supabase = createClient()
    const ids = Array.from(selected)
    const { error } = await supabase.from("payments").delete().in("id", ids)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Deleted ${ids.length} payment${ids.length !== 1 ? "s" : ""}` })
    clear()
    setConfirmOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <BulkBar
        count={selected.size}
        entity="payment"
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
              <TableHead>Customer</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                  No payments yet. Record payments from a job page.
                </TableCell>
              </TableRow>
            ) : (
              payments.map((pmt) => (
                <TableRow key={pmt.id} className={selected.has(pmt.id) ? "bg-primary/5" : ""}>
                  <TableCell className="px-3">
                    <input
                      type="checkbox"
                      checked={selected.has(pmt.id)}
                      onChange={(e) => toggle(pmt.id, e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </TableCell>
                  <TableCell className="text-sm">
                    {pmt.customer ? (
                      <Link href={`/customers/${pmt.customer.id}`} className="font-medium hover:text-primary">
                        {pmt.customer.name}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {pmt.job ? (
                      <Link href={`/jobs/${pmt.job.id}`} className="hover:text-primary">
                        {pmt.job.title}
                      </Link>
                    ) : "—"}
                  </TableCell>
                  <TableCell className="font-bold text-success">
                    {formatCurrency(Number(pmt.amount))}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {pmt.method.replace("_", " ")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(pmt.date)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{pmt.notes ?? "—"}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        count={selected.size}
        entity="payment"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        deleting={deleting}
      />
    </div>
  )
}
