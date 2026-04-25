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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity"
import { Loader2, Receipt } from "lucide-react"
import { cn } from "@/lib/utils"

const ALL_CATEGORIES = [
  "materials", "labor", "subcontractors", "permits", "dump_fees",
  "equipment", "gas", "vehicle", "tools", "office_rent", "software",
  "insurance", "marketing", "meals", "travel", "misc",
] as const

const CAT_LABEL = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

const schema = z.object({
  expense_type: z.enum(["job", "business"]),
  job_id: z.string().optional(),
  category: z.enum(ALL_CATEGORIES),
  description: z.string().min(1, "Required"),
  amount: z.number().min(0.01, "Amount must be > 0"),
  date: z.string().min(1, "Required"),
}).refine(
  (d) => !(d.expense_type === "job" && !d.job_id),
  { message: "Select a job for job expenses", path: ["job_id"] },
)

type FormValues = z.infer<typeof schema>

interface AddExpenseDialogProps {
  jobId?: string
  userId: string
  size?: "default" | "sm"
}

export function AddExpenseDialog({ jobId, userId, size = "default" }: AddExpenseDialogProps) {
  const [open, setOpen] = useState(false)
  const [jobs, setJobs] = useState<{ id: string; title: string }[]>([])
  const router = useRouter()
  const { toast } = useToast()

  const defaultValues: FormValues = {
    expense_type: "job",
    job_id: jobId ?? "",
    category: "materials",
    description: "",
    amount: 0,
    date: new Date().toISOString().split("T")[0],
  }

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  })

  const expenseType = form.watch("expense_type")

  // Fetch jobs when dialog opens (only needed when no pre-set jobId)
  useEffect(() => {
    if (!open || jobId) return
    const supabase = createClient()
    supabase
      .from("jobs")
      .select("id, title")
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .order("title")
      .then(({ data }) => setJobs(data ?? []))
  }, [open, jobId, userId])

  async function onSubmit(values: FormValues) {
    const supabase = createClient()
    const resolvedJobId =
      values.expense_type === "job" ? (jobId ?? values.job_id ?? null) : null

    const { data: inserted, error } = await supabase
      .from("expenses")
      .insert({
        user_id:      userId,
        expense_type: values.expense_type,
        job_id:       resolvedJobId,
        category:     values.category,
        description:  values.description,
        amount:       values.amount,
        date:         values.date,
      })
      .select("id")
      .single()

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }

    await logActivity(supabase, {
      userId,
      entityType: "expense",
      entityId:   inserted.id,
      action:     "created",
      description: `Expense added: ${values.description} — $${values.amount.toFixed(2)} (${CAT_LABEL(values.category)})`,
      jobId: resolvedJobId ?? undefined,
    })

    toast({ title: "Expense added", description: `${values.description} — $${values.amount}` })
    form.reset(defaultValues)
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size={size}>
          <Receipt className="w-4 h-4 mr-2" />Add Expense
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">

            {/* Type toggle — only when no pre-set jobId */}
            {!jobId && (
              <FormField control={form.control} name="expense_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Type</FormLabel>
                  <div className="flex rounded-md border overflow-hidden">
                    {(["job", "business"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={cn(
                          "flex-1 px-3 py-1.5 text-sm font-medium transition-colors",
                          field.value === t
                            ? "bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-muted",
                        )}
                        onClick={() => field.onChange(t)}
                      >
                        {t === "job" ? "Job Expense" : "Business / Overhead"}
                      </button>
                    ))}
                  </div>
                </FormItem>
              )} />
            )}

            {/* Job selector — only when no pre-set jobId and type is job */}
            {!jobId && expenseType === "job" && (
              <FormField control={form.control} name="job_id" render={({ field }) => (
                <FormItem>
                  <FormLabel>Job</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a job" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {jobs.length === 0
                        ? <SelectItem value="_none" disabled>No active jobs</SelectItem>
                        : jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>)
                      }
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="category" render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {ALL_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{CAT_LABEL(c)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Input placeholder="What was purchased or done?" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

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

              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Expense
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
