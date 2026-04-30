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
import { NumericInput } from "@/components/ui/numeric-input"
import { Textarea } from "@/components/ui/textarea"
import { DatePicker } from "@/components/ui/date-picker"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { FilePlus, Loader2, Plus, Trash2 } from "lucide-react"

const PAYMENT_METHOD_OPTIONS = [
  { value: "zelle",  label: "Zelle" },
  { value: "cash",   label: "Cash" },
  { value: "check",  label: "Check" },
  { value: "venmo",  label: "Venmo" },
]

const schema = z.object({
  type:            z.string().min(1, "Select a type"),
  amount:          z.number().min(0.01, "Amount must be > 0"),
  due_date:        z.string().optional(),
  notes:           z.string().optional(),
  payment_methods: z.array(z.string()).min(1, "Select at least one payment method"),
})
type FormValues = z.infer<typeof schema>

interface InvoiceTypeOption { value: string; label: string; is_default: boolean }

const DEFAULT_TYPES: InvoiceTypeOption[] = [
  { value: "deposit",  label: "Deposit",  is_default: true },
  { value: "progress", label: "Progress", is_default: true },
  { value: "final",    label: "Final",    is_default: true },
]

interface AddInvoiceDialogProps {
  jobId: string
  customerId: string
  userId: string
  estimateTotal: number
  existingInvoicesTotal: number
  size?: "default" | "sm"
  defaultNotes?: string
}

function typeLabel(value: string, types: InvoiceTypeOption[]): string {
  return types.find((t) => t.value === value)?.label
    ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
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
  const [manageOpen, setManageOpen] = useState(false)
  const [invoiceTypes, setInvoiceTypes] = useState<InvoiceTypeOption[]>(DEFAULT_TYPES)
  const [newTypeLabel, setNewTypeLabel] = useState("")
  const [addingType, setAddingType] = useState(false)
  const [deletingType, setDeletingType] = useState<string | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    fetch("/api/invoice-types")
      .then((r) => r.json())
      .then((data: InvoiceTypeOption[]) => Array.isArray(data) && setInvoiceTypes(data))
      .catch(() => {})
  }, [])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      type: "progress",
      amount: 0,
      due_date: "",
      notes: defaultNotes ?? "",
      payment_methods: ["zelle", "cash", "check"],
    },
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
        job_id:          jobId,
        customer_id:     customerId,
        user_id:         userId,
        type:            values.type,
        status:          "draft",
        amount:          values.amount,
        due_date:        values.due_date || null,
        notes:           values.notes || null,
        payment_methods: values.payment_methods,
      })
      .select("id, invoice_number")
      .single()

    if (error || !inserted) {
      toast({ title: "Error creating invoice", description: error?.message, variant: "destructive" })
      return
    }

    const label = typeLabel(values.type, invoiceTypes)

    await logActivity(supabase, {
      userId,
      entityType: "job",
      entityId: jobId,
      action: "invoice_created",
      description: `${label} invoice${inserted.invoice_number ? ` ${inserted.invoice_number}` : ""} created for ${formatCurrency(values.amount)}`,
      jobId,
    })

    toast({
      title: "Invoice created",
      description: inserted.invoice_number
        ? `${label} · ${inserted.invoice_number} · ${formatCurrency(values.amount)}`
        : `${label} — ${formatCurrency(values.amount)}`,
    })
    form.reset({
      type: "progress",
      amount: 0,
      due_date: "",
      notes: defaultNotes ?? "",
      payment_methods: ["zelle", "cash", "check"],
    })
    setOpen(false)
    router.refresh()
  }

  async function handleAddType() {
    if (!newTypeLabel.trim()) return
    setAddingType(true)
    try {
      const res = await fetch("/api/invoice-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newTypeLabel.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" })
        return
      }
      setInvoiceTypes((prev) => [...prev, data as InvoiceTypeOption])
      form.setValue("type", data.value)
      setNewTypeLabel("")
      toast({ title: "Invoice type added" })
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setAddingType(false)
    }
  }

  async function handleDeleteType(value: string) {
    setDeletingType(value)
    try {
      const res = await fetch("/api/invoice-types", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" })
        return
      }
      setInvoiceTypes((prev) => prev.filter((t) => t.value !== value))
      if (form.getValues("type") === value) form.setValue("type", "progress")
      toast({
        title: "Invoice type removed",
        description: data.archived
          ? `Archived — ${data.affected} existing invoice${data.affected !== 1 ? "s" : ""} unchanged`
          : "Deleted",
      })
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setDeletingType(null)
    }
  }

  const remainingForFinal = Math.max(0, estimateTotal - existingInvoicesTotal)
  const customTypes = invoiceTypes.filter((t) => !t.is_default)

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button size={size} variant="outline" className="gap-1.5">
            <FilePlus className="w-4 h-4" />
            New Invoice
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Invoice</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 pt-1">
              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <div className="flex gap-2">
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger className="flex-1">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {invoiceTypes.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                            {t.value === "final" && estimateTotal > 0 && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                (auto-fills {formatCurrency(remainingForFinal)} remaining)
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setManageOpen(true)}
                      title="Manage invoice types"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
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

              <FormField control={form.control} name="payment_methods" render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Methods Accepted</FormLabel>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {PAYMENT_METHOD_OPTIONS.map((opt) => (
                      <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          checked={field.value?.includes(opt.value)}
                          onChange={(e) => {
                            const current = field.value ?? []
                            field.onChange(
                              e.target.checked
                                ? [...current, opt.value]
                                : current.filter((v) => v !== opt.value)
                            )
                          }}
                        />
                        <span className="text-sm">{opt.label}</span>
                      </label>
                    ))}
                  </div>
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

      {/* Manage invoice types dialog */}
      <Dialog open={manageOpen} onOpenChange={(o) => { setManageOpen(o); if (!o) setNewTypeLabel("") }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Invoice Types</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            {customTypes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Types</p>
                <div className="rounded-lg border divide-y">
                  {customTypes.map((t) => (
                    <div key={t.value} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm">{t.label}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => handleDeleteType(t.value)}
                        disabled={deletingType === t.value}
                      >
                        {deletingType === t.value
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Type</p>
              <Input
                placeholder="e.g. Materials, Retainer..."
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddType() } }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setManageOpen(false)} disabled={addingType}>Close</Button>
            <Button onClick={handleAddType} disabled={addingType || !newTypeLabel.trim()}>
              {addingType && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Type
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
