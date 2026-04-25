"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumericInput } from "@/components/ui/numeric-input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { logActivity, advanceCustomerStatus } from "@/lib/activity"
import { formatCurrency } from "@/lib/utils"
import { DollarSign, Loader2 } from "lucide-react"
import type { InvoiceStatus, InvoiceWithBalance } from "@/types"

const schema = z.object({
  amount: z.number().min(0.01, "Amount must be > 0"),
  method: z.enum(["cash","check","zelle","venmo","credit_card","bank_transfer","other"]),
  date:   z.string().min(1, "Required"),
  notes:  z.string().optional(),
})
type FormValues = z.infer<typeof schema>

interface AddPaymentDialogProps {
  jobId: string
  customerId: string
  userId: string
  size?: "default" | "sm"
  invoices?: InvoiceWithBalance[]
  preselectedInvoiceId?: string
}

export function AddPaymentDialog({
  jobId,
  customerId,
  userId,
  size = "default",
  invoices,
  preselectedInvoiceId,
}: AddPaymentDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>(preselectedInvoiceId ?? "none")
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: 0,
      method: "check",
      date:   new Date().toISOString().split("T")[0],
      notes:  "",
    },
  })

  // Auto-fill amount with remaining invoice balance when an invoice is selected
  useEffect(() => {
    if (selectedInvoiceId === "none" || !invoices) return
    const inv = invoices.find((i) => i.id === selectedInvoiceId)
    if (!inv || inv.amount_remaining <= 0) return
    form.setValue("amount", inv.amount_remaining)
  }, [selectedInvoiceId, invoices, form])

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedInvoiceId(preselectedInvoiceId ?? "none")
    }
  }, [open, preselectedInvoiceId])

  async function onSubmit(values: FormValues) {
    const supabase = createClient()
    const invoiceIdToSave = selectedInvoiceId !== "none" ? selectedInvoiceId : null

    const { data: inserted, error } = await supabase
      .from("payments")
      .insert({
        ...values,
        job_id:      jobId,
        customer_id: customerId,
        user_id:     userId,
        invoice_id:  invoiceIdToSave,
      })
      .select("id")
      .single()

    if (error || !inserted) {
      toast({ title: "Error", description: error?.message, variant: "destructive" })
      return
    }

    await logActivity(supabase, {
      userId,
      entityType: "payment",
      entityId: inserted.id,
      action: "created",
      description: `Payment recorded: $${values.amount.toFixed(2)} via ${values.method.replace(/_/g, " ")}`,
      jobId,
    })

    // Update invoice status if linked
    if (invoiceIdToSave) {
      const [{ data: invPayments }, { data: invoice }] = await Promise.all([
        supabase.from("payments").select("amount").eq("invoice_id", invoiceIdToSave),
        supabase.from("invoices").select("amount").eq("id", invoiceIdToSave).single(),
      ])
      const totalPaid = (invPayments ?? []).reduce((s, p) => s + Number(p.amount), 0)
      const invoiceAmount = Number(invoice?.amount ?? 0)
      const newStatus: InvoiceStatus =
        invoiceAmount > 0 && totalPaid >= invoiceAmount ? "paid"
        : totalPaid > 0 ? "partial"
        : "sent"
      await supabase.from("invoices").update({ status: newStatus }).eq("id", invoiceIdToSave)
    }

    // Advance customer to "Paid" if job is completed and fully paid
    const [{ data: jobData }, { data: allPayments }] = await Promise.all([
      supabase.from("jobs").select("status, estimate:estimates(total)").eq("id", jobId).single(),
      supabase.from("payments").select("amount").eq("job_id", jobId),
    ])
    const estimateTotal = Number((jobData?.estimate as any)?.total ?? 0)
    const totalPaidOnJob = (allPayments ?? []).reduce((s: number, p: { amount: unknown }) => s + Number(p.amount), 0)
    if (jobData?.status === "completed" && estimateTotal > 0 && totalPaidOnJob >= estimateTotal) {
      await advanceCustomerStatus(supabase, customerId, "Paid")
    }

    toast({
      title: "Payment recorded",
      description: `$${values.amount.toFixed(2)} via ${values.method.replace(/_/g, " ")}`,
    })
    form.reset()
    setOpen(false)
    router.refresh()
  }

  const hasInvoices = invoices && invoices.length > 0
  const selectedInvoice = invoices?.find((i) => i.id === selectedInvoiceId)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size}>
          <DollarSign className="w-4 h-4 mr-2" />Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Invoice selector — only shown when invoices exist */}
            {hasInvoices && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Link to Invoice (optional)</label>
                <Select value={selectedInvoiceId} onValueChange={setSelectedInvoiceId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">General payment — no invoice</SelectItem>
                    {invoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.type.charAt(0).toUpperCase() + inv.type.slice(1)} — {formatCurrency(inv.amount)}
                        {inv.amount_remaining > 0
                          ? ` (${formatCurrency(inv.amount_remaining)} remaining)`
                          : " (paid)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedInvoice && selectedInvoice.amount_remaining > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Amount auto-filled with remaining balance. You can edit it.
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
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

              <FormField control={form.control} name="method" render={({ field }) => (
                <FormItem>
                  <FormLabel>Method</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {["cash","check","zelle","venmo","credit_card","bank_transfer","other"].map((m) => (
                        <SelectItem key={m} value={m} className="capitalize">{m.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="date" render={({ field }) => (
              <FormItem>
                <FormLabel>Date</FormLabel>
                <FormControl><Input type="date" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes (optional)</FormLabel>
                <FormControl>
                  <Textarea placeholder="Check #, invoice reference..." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Record Payment
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
