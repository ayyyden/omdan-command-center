"use client"

import { useState, useEffect } from "react"
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
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, Mail, Pencil, Send, Trash2, Undo2 } from "lucide-react"
import type { InvoiceStatus, InvoiceWithBalance } from "@/types"

interface InvoiceTypeOption { value: string; label: string; is_default: boolean }

const DEFAULT_TYPES: InvoiceTypeOption[] = [
  { value: "deposit",  label: "Deposit",  is_default: true },
  { value: "progress", label: "Progress", is_default: true },
  { value: "final",    label: "Final",    is_default: true },
]

const editSchema = z.object({
  type:     z.string().min(1, "Select a type"),
  amount:   z.number().min(0.01, "Amount must be > 0"),
  due_date: z.string().optional(),
  notes:    z.string().optional(),
})
type EditValues = z.infer<typeof editSchema>

interface InvoiceActionsProps {
  invoice: InvoiceWithBalance
  customerEmail: string | null
  customerName: string
  jobTitle: string
  companyName: string | null
}

const BUILT_IN_LABELS: Record<string, string> = {
  deposit:  "Deposit",
  progress: "Progress",
  final:    "Final",
}

function resolveTypeLabel(value: string, types: InvoiceTypeOption[]): string {
  return types.find((t) => t.value === value)?.label
    ?? BUILT_IN_LABELS[value]
    ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

export function InvoiceActions({
  invoice,
  customerEmail,
  customerName,
  jobTitle,
  companyName,
}: InvoiceActionsProps) {
  const [editOpen, setEditOpen]       = useState(false)
  const [deleteOpen, setDeleteOpen]   = useState(false)
  const [sendOpen, setSendOpen]       = useState(false)
  const [statusLoading, setStatusLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [sending, setSending]         = useState(false)
  const [invoiceTypes, setInvoiceTypes] = useState<InvoiceTypeOption[]>(DEFAULT_TYPES)
  const [sendTo, setSendTo]           = useState(customerEmail ?? "")
  const [sendSubject, setSendSubject] = useState(
    `${BUILT_IN_LABELS[invoice.type] ?? "Invoice"} from ${companyName ?? "Us"}${invoice.invoice_number ? ` — ${invoice.invoice_number}` : ""}`
  )
  const [sendBody, setSendBody]       = useState("")
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    fetch("/api/invoice-types")
      .then((r) => r.json())
      .then((data: InvoiceTypeOption[]) => Array.isArray(data) && setInvoiceTypes(data))
      .catch(() => {})
  }, [])

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

  function handleSendOpen(open: boolean) {
    if (open) {
      setSendTo(customerEmail ?? "")
      setSendSubject(
        `${resolveTypeLabel(invoice.type, invoiceTypes) ?? "Invoice"} from ${companyName ?? "Us"}${invoice.invoice_number ? ` — ${invoice.invoice_number}` : ""}`
      )
      setSendBody("")
    }
    setSendOpen(open)
  }

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

    const { data: invPayments } = await supabase
      .from("payments").select("amount").eq("invoice_id", invoice.id)

    const totalPaid = (invPayments ?? []).reduce(
      (s: number, p: { amount: unknown }) => s + Number(p.amount), 0
    )

    let newStatus: InvoiceStatus = invoice.status
    if (totalPaid > 0) {
      newStatus = totalPaid >= values.amount ? "paid" : "partial"
    }

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

  async function handleSend() {
    if (!sendTo) { toast({ title: "Recipient email required", variant: "destructive" }); return }
    setSending(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: sendTo, subject: sendSubject, body: sendBody }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast({ title: "Send failed", description: (d as any).error ?? "Unknown error", variant: "destructive" })
        return
      }
      toast({ title: "Invoice sent", description: `Email sent to ${sendTo}` })
      setSendOpen(false)
      router.refresh()
    } catch {
      toast({ title: "Send failed", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  const canToggle = invoice.status === "draft" || invoice.status === "sent"

  return (
    <>
      <div className="flex items-center gap-0.5">
        {(invoice.status === "draft" || invoice.status === "sent") && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs px-2 gap-1"
            onClick={() => handleSendOpen(true)}
          >
            <Mail className="w-3 h-3" />Email
          </Button>
        )}
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

      {/* Send dialog */}
      <Dialog open={sendOpen} onOpenChange={handleSendOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Email Invoice{invoice.invoice_number ? ` — ${invoice.invoice_number}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {invoice.invoice_number && (
              <p className="text-xs text-muted-foreground">
                Invoice # <span className="font-semibold text-foreground">{invoice.invoice_number}</span>
                {" · "}{resolveTypeLabel(invoice.type, invoiceTypes)} · {formatCurrency(invoice.amount)}
              </p>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input type="email" value={sendTo} onChange={(e) => setSendTo(e.target.value)} placeholder="customer@example.com" />
              {!customerEmail && <p className="text-xs text-warning">No email on file — enter one above.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message (optional)</label>
              <Textarea
                value={sendBody}
                onChange={(e) => setSendBody(e.target.value)}
                placeholder="Add a personal note, or leave blank for default invoice message…"
                className="min-h-[100px] text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Invoice details, amount, and accepted payment methods will be included automatically.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !sendTo}>
              {sending
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
                : <><Mail className="w-4 h-4 mr-1.5" />Send Invoice</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                      {invoiceTypes.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
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
                  <FormControl>
                    <DatePicker
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="Select a due date"
                    />
                  </FormControl>
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
