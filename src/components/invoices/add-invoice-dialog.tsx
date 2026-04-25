"use client"

import { useState, useEffect } from "react"
import { useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { logActivity } from "@/lib/activity"
import { formatCurrency } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumericInput } from "@/components/ui/numeric-input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { FilePlus, Loader2 } from "lucide-react"
import type { InvoiceType } from "@/types"

const schema = z.object({
  type:     z.enum(["deposit", "progress", "final"]),
  amount:   z.number().min(0.01, "Amount must be > 0"),
  due_date: z.string().optional(),
  notes:    z.string().optional(),
})
type FormValues = z.infer<typeof schema>

interface AddInvoiceDialogProps {
  jobId: string
  customerId: string
  userId: string
  estimateTotal: number
  existingInvoicesTotal: number
  size?: "default" | "sm"
  defaultNotes?: string
}

const TYPE_LABELS: Record<InvoiceType, string> = {
  deposit:  "Deposit",
  progress: "Progress",
  final:    "Final",
}

export function AddInvoiceDialog({
  jobId,
  customerId,
  userId,
  estimateTotal,
  existingInvoicesTotal,
  size = "default",
  defaultNotes,
}: AddInvoiceDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: "progress", amount: 0, due_date: "", notes: defaultNotes ?? "" },
  })

  const type = useWatch({ control: form.control, name: "type" })

  // Auto-fill amount for Final invoice type
  useEffect(() => {
    if (type === "final" && estimateTotal > 0) {
      const remaining = Math.max(0, estimateTotal - existingInvoicesTotal)
      form.setValue("amount", remaining)
    }
  }, [type, estimateTotal, existingInvoicesTotal, form])

  async function onSubmit(values: FormValues) {
    const supabase = createClient()

    const { data: inserted, error } = await supabase
      .from("invoices")
      .insert({
        job_id:      jobId,
        customer_id: customerId,
        user_id:     userId,
        type:        values.type,
        status:      "draft",
        amount:      values.amount,
        due_date:    values.due_date || null,
        notes:       values.notes || null,
      })
      .select("id")
      .single()

    if (error || !inserted) {
      toast({ title: "Error creating invoice", description: error?.message, variant: "destructive" })
      return
    }

    await logActivity(supabase, {
      userId,
      entityType: "job",
      entityId: jobId,
      action: "invoice_created",
      description: `${TYPE_LABELS[values.type]} invoice created for ${formatCurrency(values.amount)}`,
      jobId,
    })

    toast({
      title: "Invoice created",
      description: `${TYPE_LABELS[values.type]} — ${formatCurrency(values.amount)}`,
    })
    form.reset()
    setOpen(false)
    router.refresh()
  }

  const remainingForFinal = Math.max(0, estimateTotal - existingInvoicesTotal)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline" className="gap-1.5">
          <FilePlus className="w-4 h-4" />
          New Invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="deposit">Deposit</SelectItem>
                    <SelectItem value="progress">Progress</SelectItem>
                    <SelectItem value="final">
                      Final
                      {estimateTotal > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (auto-fills {formatCurrency(remainingForFinal)} remaining)
                        </span>
                      )}
                    </SelectItem>
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
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Invoice
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
