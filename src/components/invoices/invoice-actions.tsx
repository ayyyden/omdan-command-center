"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumericInput } from "@/components/ui/numeric-input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Pencil, Send, Trash2, Undo2 } from "lucide-react"
import type { InvoiceStatus, InvoiceWithBalance } from "@/types"

const editSchema = z.object({
  type:     z.enum(["deposit", "progress", "final"]),
  amount:   z.number().min(0.01, "Amount must be > 0"),
  due_date: z.string().optional(),
  notes:    z.string().optional(),
})
type EditValues = z.infer<typeof editSchema>

interface InvoiceActionsProps {
  invoice: InvoiceWithBalance
}

export function InvoiceActions({ invoice }: InvoiceActionsProps) {
  const [editOpen, setEditOpen]       = useState(false)
  const [deleteOpen, setDeleteOpen]   = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      type:     invoice.type,
      amount:   invoice.amount,
      due_date: invoice.due_date ?? "",
      notes:    invoice.notes ?? "",
    },
  })

  function handleEditOpen(open: boolean) {
    if (open) {
      form.reset({
        type:     invoice.type,
        amount:   invoice.amount,
        due_date: invoice.due_date ?? "",
        notes:    invoice.notes ?? "",
      })
    }
    setEditOpen(open)
  }

  // Draft ↔ Sent toggle (only for user-controlled statuses)
  async function handleStatusToggle() {
    setStatusLoading(true)
    const supabase = createClient()
    const next: InvoiceStatus = invoice.status === "draft" ? "sent" : "draft"
    const { error } = await supabase.from("invoices").update({ status: next }).eq("id", invoice.id)
    setStatusLoading(false)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    router.refresh()
  }

  async function handleEdit(values: EditValues) {
    const supabase = createClient()

    // Recompute status from payments so it stays accurate after amount change
    const { data: invPayments } = await supabase
      .from("payments").select("amount").eq("invoice_id", invoice.id)

    const totalPaid = (invPayments ?? []).reduce(
      (s: number, p: { amount: unknown }) => s + Number(p.amount), 0
    )

    let newStatus: InvoiceStatus = invoice.status
    if (totalPaid > 0) {
      newStatus = totalPaid >= values.amount ? "paid" : "partial"
    }
    // If no payments, preserve the current draft/sent status

    const { error } = await supabase
      .from("invoices")
      .update({
        type:     values.type,
        amount:   values.amount,
        due_date: values.due_date || null,
        notes:    values.notes    || null,
        status:   newStatus,
      })
      .eq("id", invoice.id)

    if (error) {
      toast({ title: "Error saving changes", description: error.message, variant: "destructive" })
      return
    }

    toast({ title: "Invoice updated" })
    setEditOpen(false)
    router.refresh()
  }

  async function handleDelete() {
    setDeleteLoading(true)
    const supabase = createClient()
    // ON DELETE SET NULL in the FK handles payments.invoice_id automatically
    const { error } = await supabase.from("invoices").delete().eq("id", invoice.id)
    setDeleteLoading(false)
    if (error) {
      toast({ title: "Error deleting invoice", description: error.message, variant: "destructive" })
      setDeleteOpen(false)
      return
    }
    toast({ title: "Invoice deleted", description: "Linked payments were kept and unlinked." })
    setDeleteOpen(false)
    router.refresh()
  }

  const canToggle = invoice.status === "draft" || invoice.status === "sent"

  return (
    <>
      <div className="flex items-center gap-0.5">
        {canToggle && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={handleStatusToggle}
            disabled={statusLoading}
          >
            {statusLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : invoice.status === "draft" ? (
              <><Send className="w-3 h-3" />Mark Sent</>
            ) : (
              <><Undo2 className="w-3 h-3" />Draft</>
            )}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          onClick={() => handleEditOpen(true)}
        >
          <Pencil className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={handleEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleEdit)} className="space-y-4 pt-1">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="deposit">Deposit</SelectItem>
                      <SelectItem value="progress">Progress</SelectItem>
                      <SelectItem value="final">Final</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <NumericInput
                      min="0"
                      placeholder="0.00"
                      value={field.value}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      onBlur={field.onBlur}
                      name={field.name}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="due_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Due Date (optional)</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes (optional)</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Any details about this invoice..." {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <div className="flex gap-2 justify-end pt-1">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Invoice?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            The <strong className="text-foreground">{formatCurrency(invoice.amount)}</strong> invoice will
            be permanently deleted. Payments linked to it will be kept and unlinked from this invoice.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
