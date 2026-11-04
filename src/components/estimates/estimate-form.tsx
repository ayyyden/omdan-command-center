"use client"

import { useState, useRef, useCallback } from "react"
import { useForm, useFieldArray, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { v4 as uuidv4 } from "uuid"
import { createClient } from "@/lib/supabase/client"
import { estimateSchema, type EstimateFormValues } from "@/lib/validations/estimate"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NumericInput } from "@/components/ui/numeric-input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatCurrency, cn } from "@/lib/utils"
import { Loader2, Plus, Trash2, Send, Wand2, AlertCircle, Sparkles, CheckCircle2, UserRound, Save } from "lucide-react"
import { serializeScope, defaultEstimateEmail } from "@/lib/estimate-format"
import { upsertEstimateFollowUp } from "@/lib/reminders"
import type { Customer, Estimate } from "@/types"

interface Template {
  id: string
  name: string
  type: string
  subject: string | null
  body: string
}

interface CompanySettings {
  company_name: string | null
  phone: string | null
  email: string | null
  license_number: string | null
  logo_url: string | null
  address: string | null
  google_review_link: string | null
  default_estimate_notes?: string | null
}

interface EstimateFormProps {
  estimate?: Estimate
  customers: Customer[]
  userId: string
  preselectedCustomerId?: string
  defaultNotes?: string
  templates?: Template[]
  companySettings?: CompanySettings | null
}

function renderTemplate(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`)
}

function calcTotals(lineItems: EstimateFormValues["line_items"], markupPct: number, taxPct: number) {
  const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unit_price, 0)
  const markupAmount = subtotal * (markupPct / 100)
  const taxableItemsTotal = lineItems.reduce((sum, item) => {
    if (item.taxable === false) return sum
    return sum + item.quantity * item.unit_price
  }, 0)
  const taxBase = taxableItemsTotal * (1 + markupPct / 100)
  const taxAmount = taxBase * (taxPct / 100)
  const total = subtotal + markupAmount + taxAmount
  return { subtotal, markupAmount, taxAmount, total }
}

function generateTitleFromScope(scope: string): string {
  const lower = scope.toLowerCase()
  const keywords: Record<string, string> = {
    kitchen: "Kitchen Renovation",
    bathroom: "Bathroom Remodel",
    deck: "Deck Installation",
    roof: "Roofing Project",
    flooring: "Flooring Installation",
    paint: "Painting Project",
    fence: "Fence Installation",
    landscap: "Landscaping Project",
    drywall: "Drywall Repair",
    plumb: "Plumbing Work",
    electric: "Electrical Work",
    window: "Window Installation",
    door: "Door Installation",
    garage: "Garage Project",
    basement: "Basement Renovation",
    addition: "Home Addition",
    remodel: "Home Remodel",
    renovation: "Renovation Project",
    repair: "Repair Work",
    install: "Installation Project",
    hvac: "HVAC Service",
    ac: "AC Service",
  }
  for (const [kw, title] of Object.entries(keywords)) {
    if (lower.includes(kw)) return title
  }
  const words = scope.trim().split(/\s+/).slice(0, 4).join(" ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function EstimateForm({
  estimate, customers, userId, preselectedCustomerId, defaultNotes,
  templates = [], companySettings,
}: EstimateFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const lineItemsRef = useRef<HTMLDivElement>(null)

  const [sendOpen, setSendOpen]             = useState(false)
  const [savingForSend, setSavingForSend]   = useState(false)
  const [sending, setSending]               = useState(false)
  const [savedEstimateId, setSavedEstimateId] = useState<string | null>(null)
  const [selectedTplId, setSelectedTplId]   = useState("")
  const [to, setTo]       = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody]   = useState("")
  const [generatingTitle, setGeneratingTitle] = useState(false)

  // "Describe the job" -> AI writes the detailed scope (estimate-writer.ts)
  const [brief, setBrief]               = useState<string>((estimate as any)?.brief ?? "")
  const [writing, setWriting]           = useState(false)
  const [writeWarning, setWriteWarning] = useState<string | null>(null)

  // "Prepared for": the lead's details as they'll print on the estimate —
  // fix them here and save them back to the lead card
  const [customerList, setCustomerList] = useState<Customer[]>(customers)
  const [pf, setPf]             = useState({ name: "", phone: "", email: "", address: "" })
  const [pfDirty, setPfDirty]   = useState(false)
  const [savingPf, setSavingPf] = useState(false)

  const followUpTemplates = templates.filter((t) => t.type === "estimate_follow_up")

  const form = useForm<EstimateFormValues>({
    resolver: zodResolver(estimateSchema),
    defaultValues: {
      customer_id:        estimate?.customer_id    ?? preselectedCustomerId ?? "",
      title:              estimate?.title          ?? "",
      scope_of_work:      estimate?.scope_of_work  ?? "",
      manual_total_price: (estimate as any)?.manual_total_price ?? undefined,
      line_items: estimate?.line_items?.map((item) => ({
        ...item,
        taxable: (item as any).taxable !== false,
      })) ?? [],
      markup_percent: estimate?.markup_percent ?? 0,
      tax_percent:    estimate?.tax_percent    ?? 0,
      status:         estimate?.status         ?? "draft",
      notes:          estimate?.notes          ?? defaultNotes ?? "",
      payment_steps:  (estimate as any)?.payment_steps ?? [],
    },
  })

  const customerId = useWatch({ control: form.control, name: "customer_id" })
  // Load the lead's details whenever a different customer is picked
  const [pfFor, setPfFor] = useState<string | null>(null)
  if (customerId && pfFor !== customerId) {
    const c = customerList.find((x) => x.id === customerId)
    if (c) {
      setPfFor(customerId)
      setPf({ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "" })
      setPfDirty(false)
    }
  }

  async function savePreparedFor(): Promise<boolean> {
    if (!customerId) return false
    if (!pf.name.trim()) { toast({ title: "The lead needs a name", variant: "destructive" }); return false }
    setSavingPf(true)
    const supabase = createClient()
    const patch = { name: pf.name.trim(), phone: pf.phone.trim() || null, email: pf.email.trim() || null, address: pf.address.trim() || null }
    const { error } = await supabase.from("customers").update(patch).eq("id", customerId)
    setSavingPf(false)
    if (error) { toast({ title: "Couldn't update the lead card", description: error.message, variant: "destructive" }); return false }
    setCustomerList((list) => list.map((c) => (c.id === customerId ? ({ ...c, ...patch } as Customer) : c)))
    setPfDirty(false)
    toast({ title: "Lead card updated", description: patch.name })
    return true
  }

  async function writeWithAI() {
    if (brief.trim().length < 8) { toast({ title: "Describe the job first", variant: "destructive" }); return }
    setWriting(true); setWriteWarning(null)
    try {
      const res = await fetch("/api/estimates/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Couldn't write the scope")
      form.setValue("title", data.title, { shouldDirty: true })
      form.setValue("scope_of_work", serializeScope(data.sections), { shouldDirty: true })
      if (data.total) form.setValue("manual_total_price", data.total, { shouldDirty: true })
      if (data.payment_steps?.length) {
        form.setValue("payment_steps", data.payment_steps.map((p: { name: string; description: string; amount: number }) => ({ id: uuidv4(), name: p.name, description: p.description, amount: p.amount })), { shouldDirty: true })
      }
      if (data.notes?.length) form.setValue("notes", data.notes.join("\n"), { shouldDirty: true })
      setWriteWarning(data.warning ?? null)
      toast({ title: "Scope written", description: `${data.sections.length} sections · ${data.payment_steps?.length ?? 0} payments — check it, then save.` })
    } catch (err) {
      toast({ title: "Couldn't write the scope", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
    } finally {
      setWriting(false)
    }
  }

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "line_items" })
  const { fields: paymentStepFields, append: appendStep, remove: removeStep } = useFieldArray({ control: form.control, name: "payment_steps" })

  const lineItems          = useWatch({ control: form.control, name: "line_items" })
  const markupPct          = useWatch({ control: form.control, name: "markup_percent" })
  const taxPct             = useWatch({ control: form.control, name: "tax_percent" })
  const manualTotalPrice   = useWatch({ control: form.control, name: "manual_total_price" })
  const paymentSteps       = useWatch({ control: form.control, name: "payment_steps" })
  const scopeOfWork        = useWatch({ control: form.control, name: "scope_of_work" })

  const { subtotal, markupAmount, taxAmount, total: lineItemTotal } = calcTotals(lineItems ?? [], markupPct ?? 0, taxPct ?? 0)
  const useManualTotal = manualTotalPrice != null && manualTotalPrice > 0
  const displayTotal = useManualTotal ? manualTotalPrice! : lineItemTotal

  const paymentStepsTotal = (paymentSteps ?? []).reduce((s, p) => s + (p.amount ?? 0), 0)
  const paymentStepsOverage = paymentStepsTotal > displayTotal && displayTotal > 0
  const paymentsMatch = (paymentSteps ?? []).length > 0 && displayTotal > 0 && Math.round(paymentStepsTotal * 100) === Math.round(displayTotal * 100)

  function appendRow() {
    append({ id: uuidv4(), description: "", quantity: 1, unit_price: 0, category: "labor", taxable: true })
    setTimeout(() => {
      if (!lineItemsRef.current) return
      const inputs = lineItemsRef.current.querySelectorAll<HTMLInputElement>("[data-line-desc]")
      const last = inputs[inputs.length - 1]
      last?.focus(); last?.select()
    }, 30)
  }

  function focusDescAt(index: number) {
    if (!lineItemsRef.current) return
    const inputs = lineItemsRef.current.querySelectorAll<HTMLInputElement>("[data-line-desc]")
    const target = inputs[index]
    target?.focus(); target?.select()
  }

  function handleGenerateTitle() {
    const scope = scopeOfWork?.trim()
    if (!scope) {
      toast({ title: "Enter a Scope of Work first to generate a title.", variant: "destructive" })
      return
    }
    setGeneratingTitle(true)
    setTimeout(() => {
      const generated = generateTitleFromScope(scope)
      form.setValue("title", generated)
      setGeneratingTitle(false)
    }, 300)
  }

  function buildTplData(values: EstimateFormValues): Record<string, string> {
    const selectedCustomer = customerList.find((c) => c.id === values.customer_id)
    const total = values.manual_total_price && values.manual_total_price > 0
      ? values.manual_total_price
      : calcTotals(values.line_items, values.markup_percent, values.tax_percent).total
    return {
      customer_name:  selectedCustomer?.name             ?? "",
      estimate_total: formatCurrency(total),
      company_name:   companySettings?.company_name      ?? "",
      sender_name:    companySettings?.company_name      ?? "",
      sender_phone:   "9512920703",
      sender_email:   companySettings?.email             ?? "",
      review_link:    companySettings?.google_review_link ?? "",
    }
  }

  function applyTemplate(tplId: string, tplData: Record<string, string>) {
    const tpl = followUpTemplates.find((t) => t.id === tplId)
    if (!tpl) return
    if (tpl.subject) setSubject(renderTemplate(tpl.subject, tplData))
    setBody(renderTemplate(tpl.body, tplData))
  }

  async function saveEstimate(values: EstimateFormValues): Promise<string | null> {
    const supabase = createClient()
    const { subtotal, markupAmount, taxAmount, total } = calcTotals(
      values.line_items, values.markup_percent, values.tax_percent,
    )
    const finalTotal = values.manual_total_price && values.manual_total_price > 0
      ? values.manual_total_price
      : total

    const payload = {
      customer_id:         values.customer_id,
      title:               values.title,
      scope_of_work:       values.scope_of_work,
      manual_total_price:  values.manual_total_price ?? null,
      line_items:          values.line_items,
      markup_percent:      values.markup_percent,
      markup_amount:       markupAmount,
      tax_percent:         values.tax_percent,
      tax_amount:          taxAmount,
      subtotal,
      total:               finalTotal,
      status:              values.status,
      notes:               values.notes,
      user_id:             userId,
      brief:               brief.trim() || null,
    } as Record<string, unknown>

    let error
    let savedId = estimate?.id ?? null

    const write = async (row: Record<string, unknown>) => {
      if (estimate) return (await supabase.from("estimates").update(row).eq("id", estimate.id)).error
      const { data: inserted, error: insertError } = await supabase.from("estimates").insert(row).select("id").single()
      savedId = inserted?.id ?? null
      return insertError
    }
    error = await write(payload)
    // Before migration 066 the "brief" column doesn't exist yet — save without it
    if (error && /brief/.test(error.message)) {
      delete payload.brief
      error = await write(payload)
    }

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return null
    }

    // Save payment steps
    if (savedId) {
      await supabase.from("estimate_payment_steps").delete().eq("estimate_id", savedId)
      const steps = (values.payment_steps ?? []).filter((s) => s.name && s.amount > 0)
      if (steps.length > 0) {
        await supabase.from("estimate_payment_steps").insert(
          steps.map((s, i) => ({
            estimate_id:  savedId,
            name:         s.name,
            amount:       s.amount,
            description:  s.description || null,
            sort_order:   i,
          }))
        )
      }
    }

    if (values.status === "sent" && savedId) {
      const customer = customers.find((c) => c.id === values.customer_id)
      if (customer) {
        await upsertEstimateFollowUp(supabase, {
          userId,
          estimateId: savedId,
          customerId: values.customer_id,
          customerName: customer.name,
        })
      }
    }

    return savedId
  }

  async function onSubmit(values: EstimateFormValues) {
    const id = await saveEstimate(values)
    if (!id) return
    toast({ title: estimate ? "Estimate updated" : "Estimate created", description: values.title })
    router.push("/estimates")
    router.refresh()
  }

  async function handleSaveAndSend() {
    const isValid = await form.trigger()
    if (!isValid) return
    if (!pf.email.trim()) {
      toast({ title: "Add the customer's email first", description: "Fill it in under Prepared for, then Save to lead card.", variant: "destructive" })
      return
    }
    if (pfDirty && !(await savePreparedFor())) return

    const values = form.getValues()
    setSavingForSend(true)
    const id = await saveEstimate(values)
    setSavingForSend(false)
    if (!id) return

    setSavedEstimateId(id)
    const selectedCustomer = customerList.find((c) => c.id === values.customer_id)
    setTo(pf.email || selectedCustomer?.email || "")
    const std = defaultEstimateEmail(pf.name || selectedCustomer?.name || "", values.title)

    // The standard estimate email; saved templates stay one pick away
    setSelectedTplId("")
    setSubject(std.subject)
    setBody(std.body)
    setSendOpen(true)
  }

  async function handleSend() {
    if (!savedEstimateId || !to) {
      toast({ title: "Recipient email is required", variant: "destructive" })
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${savedEstimateId}/send`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ to, subject, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Failed to send", description: (data as any).error ?? "Unknown error", variant: "destructive" })
        return
      }
      toast({ title: "Estimate sent", description: `Email sent to ${to}` })
      setSendOpen(false)
      router.push(`/estimates/${savedEstimateId}`)
      router.refresh()
    } catch {
      toast({ title: "Failed to send", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Describe the job → AI writes the detailed scope */}
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Describe the job</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              className="min-h-[96px] text-sm"
              placeholder={"Write it like a quick note after the visit, e.g.\npatio installation with 4-6 lights, 1 ceiling fan, aluminum with insulated roof (double layer) and a mist line. total 18726, 4 payments: architectural planning and permit submitted 7000, material arrive 5000, patio installed 5000, completion and clean up 1726"}
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" onClick={writeWithAI} disabled={writing || brief.trim().length < 8} className="gap-1.5">
                {writing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {writing ? "Writing the scope…" : "Write it for me"}
              </Button>
              <p className="text-xs text-muted-foreground">Fills in the title, detailed scope, payment schedule, total and notes. You can edit everything after.</p>
            </div>
            {writeWarning && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />{writeWarning}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Header */}
        <Card>
          <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField control={form.control} name="customer_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Customer *</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="scope_of_work" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Scope of Work <span className="font-normal text-muted-foreground text-xs">· &quot;1. Heading&quot; lines with &quot;- bullet&quot; lines under them</span></FormLabel>
                <FormControl>
                  <Textarea
                    placeholder={"1. Section heading\n- What gets done\n- What gets done\n\n2. Next section\n- …"}
                    className="min-h-[260px] text-sm leading-relaxed"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Title with generate button */}
            <FormField control={form.control} name="title" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Estimate Title *</FormLabel>
                <div className="flex gap-2">
                  <FormControl className="flex-1">
                    <Input placeholder="Kitchen Remodel — Phase 1" {...field} />
                  </FormControl>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={handleGenerateTitle}
                    disabled={generatingTitle}
                    title="Generate title from Scope of Work"
                  >
                    {generatingTitle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  </Button>
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {/* Prepared for — the lead's details as they print on the estimate */}
        {customerId && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><UserRound className="w-4 h-4 text-muted-foreground" /> Prepared for</span>
                <Button type="button" size="sm" variant={pfDirty ? "default" : "outline"} className="gap-1.5 h-8" disabled={!pfDirty || savingPf} onClick={() => void savePreparedFor()}>
                  {savingPf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pfDirty ? <Save className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  {pfDirty ? "Save to lead card" : "Matches lead card"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["name", "Full name", "text", "Maria Gonzalez"],
                ["phone", "Phone", "tel", "(760) 555-0123"],
                ["email", "Email", "email", "customer@email.com"],
                ["address", "Address", "text", "Street, City, CA ZIP"],
              ] as const).map(([key, label, type, ph]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{label}</label>
                  <Input
                    type={type}
                    value={pf[key]}
                    placeholder={ph}
                    onChange={(e) => { setPf((v) => ({ ...v, [key]: e.target.value })); setPfDirty(true) }}
                    className={cn("h-9", key === "email" && !pf.email.trim() && "border-amber-500/60 bg-amber-500/5")}
                  />
                  {key === "email" && !pf.email.trim() && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">No email yet — add it to send the estimate.</p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Total Price (manual override — shown above line items) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Total Price</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField control={form.control} name="manual_total_price" render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1 max-w-xs">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                    <FormControl>
                      <NumericInput
                        className="pl-7"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={field.value ?? ""}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value)
                          field.onChange(isNaN(v) || v === 0 ? undefined : v)
                        }}
                        onBlur={field.onBlur}
                        name={field.name}
                      />
                    </FormControl>
                  </div>
                  {useManualTotal && (
                    <span className="text-sm text-muted-foreground">Manual total · {formatCurrency(manualTotalPrice!)}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Enter the all-in job price. Leave blank to use the line item total below.
                </p>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {/* Line Items (optional) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Line Items <span className="text-xs font-normal text-muted-foreground">Optional · Tab through fields · Enter on price to add row</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 pb-4">
            {fields.length > 0 && (
              <div className="hidden sm:grid grid-cols-[1fr_96px_56px_96px_36px_32px] gap-x-2 px-2 pb-1">
                <span className="text-xs font-medium text-muted-foreground">Description</span>
                <span className="text-xs font-medium text-muted-foreground">Category</span>
                <span className="text-xs font-medium text-muted-foreground">Qty</span>
                <span className="text-xs font-medium text-muted-foreground">Unit Price</span>
                <span className="text-xs font-medium text-muted-foreground text-center">Tax</span>
                <span />
              </div>
            )}

            <div ref={lineItemsRef} className="space-y-0.5">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid grid-cols-1 sm:grid-cols-[1fr_96px_56px_96px_36px_32px] gap-x-2 gap-y-2 items-center p-3 sm:px-2 sm:py-1.5 border sm:border-0 sm:hover:bg-muted/40 rounded-md transition-colors"
                >
                  <FormField control={form.control} name={`line_items.${index}.description`} render={({ field }) => (
                    <FormItem className="sm:mb-0">
                      <FormControl>
                        <Input placeholder="Description of work or material" {...field} data-line-desc="" className="h-9" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name={`line_items.${index}.category`} render={({ field }) => (
                    <FormItem>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="labor">Labor</SelectItem>
                          <SelectItem value="materials">Materials</SelectItem>
                          <SelectItem value="subcontractor">Sub</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name={`line_items.${index}.quantity`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NumericInput className="h-9" min="0" value={field.value}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          onBlur={field.onBlur} name={field.name} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name={`line_items.${index}.unit_price`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <NumericInput className="h-9" min="0" placeholder="0.00" value={field.value}
                          onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                          onBlur={field.onBlur} name={field.name}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return
                            e.preventDefault()
                            if (index === fields.length - 1) appendRow()
                            else focusDescAt(index + 1)
                          }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name={`line_items.${index}.taxable`} render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <button type="button"
                          title={field.value !== false ? "Taxable — click to mark exempt" : "Non-taxable — click to mark taxable"}
                          className={cn("h-9 w-full rounded-md border text-[11px] font-semibold transition-colors",
                            field.value !== false
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-muted-foreground/30 text-muted-foreground"
                          )}
                          onClick={() => field.onChange(field.value === false ? true : false)}
                        >
                          {field.value !== false ? "T" : "NT"}
                        </button>
                      </FormControl>
                    </FormItem>
                  )} />

                  <Button type="button" variant="ghost" size="icon" tabIndex={-1}
                    className="text-muted-foreground hover:text-destructive w-8 h-8 shrink-0"
                    onClick={() => remove(index)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="pt-2 px-2">
              <Button type="button" variant="outline" size="sm" onClick={appendRow} className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />Add Line Item
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Totals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardContent className="pt-6 grid grid-cols-2 gap-4">
              <FormField control={form.control} name="markup_percent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Markup %</FormLabel>
                  <FormControl>
                    <NumericInput min="0" max="100" value={field.value}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      onBlur={field.onBlur} name={field.name} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="tax_percent" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tax % <span className="font-normal text-muted-foreground text-xs">(T items only)</span></FormLabel>
                  <FormControl>
                    <NumericInput min="0" max="100" value={field.value}
                      onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      onBlur={field.onBlur} name={field.name} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Project notes <span className="font-normal text-muted-foreground text-xs">(one per line)</span></FormLabel>
                  <FormControl>
                    <Textarea placeholder="Project notes — one per line" className="min-h-[110px]" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Estimate Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {!useManualTotal && fields.length > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Markup ({markupPct ?? 0}%)</span>
                    <span>{formatCurrency(markupAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Tax ({taxPct ?? 0}%)</span>
                    <span>{formatCurrency(taxAmount)}</span>
                  </div>
                  <Separator />
                </>
              )}
              <div className="flex justify-between font-bold text-lg">
                <span>Total</span>
                <span>{formatCurrency(displayTotal)}</span>
              </div>
              {useManualTotal && (
                <p className="text-xs text-muted-foreground">Using manual total price</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Payment Schedule */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              Payment Schedule
              <span className="text-xs font-normal text-muted-foreground">Optional</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paymentsMatch && (
              <div className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="w-4 h-4" /> Payments add up to the total ({formatCurrency(displayTotal)}).</div>
            )}
            {!paymentsMatch && !paymentStepsOverage && (paymentSteps ?? []).length > 0 && displayTotal > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400 text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Payments add up to {formatCurrency(paymentStepsTotal)} — {formatCurrency(displayTotal - paymentStepsTotal)} short of the total.
              </div>
            )}
            {paymentStepsOverage && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Payment steps total ({formatCurrency(paymentStepsTotal)}) exceeds estimate total ({formatCurrency(displayTotal)}).
              </div>
            )}

            {paymentStepFields.length > 0 && (
              <div className="hidden sm:grid grid-cols-[1fr_140px_1fr_32px] gap-x-2 px-1 pb-1">
                <span className="text-xs font-medium text-muted-foreground">Step Name</span>
                <span className="text-xs font-medium text-muted-foreground">Amount</span>
                <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
                <span />
              </div>
            )}

            <div className="space-y-2">
              {paymentStepFields.map((field, index) => (
                <div key={field.id} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_1fr_32px] gap-2 items-center">
                  <FormField control={form.control} name={`payment_steps.${index}.name`} render={({ field }) => (
                    <FormItem>
                      <FormControl><Input placeholder="Deposit, Phase 1, Completion…" {...field} className="h-9" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`payment_steps.${index}.amount`} render={({ field }) => (
                    <FormItem>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none">$</span>
                        <FormControl>
                          <NumericInput className="h-9 pl-7" min="0" step="0.01" placeholder="0.00"
                            value={field.value}
                            onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                            onBlur={field.onBlur} name={field.name} />
                        </FormControl>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`payment_steps.${index}.description`} render={({ field }) => (
                    <FormItem>
                      <FormControl><Input placeholder="Optional note…" {...field} className="h-9" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive w-8 h-8 shrink-0"
                    onClick={() => removeStep(index)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>

            {paymentStepFields.length > 0 && displayTotal > 0 && (
              <div className="flex justify-between text-sm pt-1">
                <span className="text-muted-foreground">
                  Assigned: {formatCurrency(paymentStepsTotal)}
                </span>
                <span className={paymentStepsOverage ? "text-destructive font-medium" : "text-muted-foreground"}>
                  Remaining: {formatCurrency(Math.max(0, displayTotal - paymentStepsTotal))}
                </span>
              </div>
            )}

            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => appendStep({ id: uuidv4(), name: "", amount: 0, description: "" })}>
              <Plus className="w-3.5 h-3.5" />Add Payment Step
            </Button>
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting || savingForSend}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {estimate ? "Save Changes" : "Create Estimate"}
          </Button>
          <Button type="button" variant="outline" className="gap-1.5"
            disabled={form.formState.isSubmitting || savingForSend}
            onClick={handleSaveAndSend}>
            {savingForSend ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Save &amp; Send
          </Button>
          <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>

      {/* Send modal */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Send Estimate</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            {followUpTemplates.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Template</label>
                <Select value={selectedTplId} onValueChange={(id) => {
                  setSelectedTplId(id)
                  applyTemplate(id, buildTplData(form.getValues()))
                }}>
                  <SelectTrigger><SelectValue placeholder="Select a template" /></SelectTrigger>
                  <SelectContent>
                    {followUpTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Estimate for…" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Message <span className="normal-case font-normal">(edit before sending)</span>
              </label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[160px] text-sm"
                placeholder="Hi, please find your estimate attached…" />
            </div>

            <p className="text-xs text-muted-foreground">Sent as a branded email with a <b>Review &amp; Sign Estimate</b> button and the PDF attached. Valid for 15 days from today.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !to || !body}>
              {sending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : <><Send className="w-4 h-4 mr-1.5" />Send Estimate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Form>
  )
}
