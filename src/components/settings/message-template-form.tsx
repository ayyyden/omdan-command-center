"use client"

import { useRef, useState } from "react"
import { useForm, useController, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Trash2 } from "lucide-react"
import type { MessageTemplate } from "@/types"

export const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  estimate_follow_up: "Estimate Follow-up",
  job_scheduled:      "Job Scheduled",
  job_reminder:       "Job Reminder",
  payment_reminder:   "Payment Reminder",
  review_request:     "Review Request",
  custom:             "Custom",
}

const VARIABLES: { key: string; label: string }[] = [
  { key: "customer_name",   label: "Customer Name" },
  { key: "job_title",       label: "Job Title" },
  { key: "estimate_total",  label: "Estimate Total" },
  { key: "invoice_balance", label: "Invoice Balance" },
  { key: "scheduled_date",  label: "Scheduled Date" },
  { key: "company_name",    label: "Company Name" },
  { key: "company_phone",   label: "Company Phone" },
  { key: "sender_name",     label: "Sender Name" },
  { key: "sender_phone",    label: "Sender Phone" },
  { key: "sender_email",    label: "Sender Email" },
  { key: "review_link",     label: "Review Link" },
]

const SAMPLE_DATA: Record<string, string> = {
  customer_name:   "John Smith",
  job_title:       "Master Bath Remodel",
  estimate_total:  "$4,500.00",
  invoice_balance: "$1,200.00",
  scheduled_date:  "Monday, May 5, 2025",
  company_name:    "Omdan Development Inc.",
  company_phone:   "(555) 123-4567",
  sender_name:     "David",
  sender_phone:    "9512920703",
  sender_email:    "sample@omdandevelopment.com",
  review_link:     "https://g.page/r/your-google-review-link",
}

function renderPreview(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => SAMPLE_DATA[key] ?? `{{${key}}}`)
}

const schema = z.object({
  name:      z.string().min(1, "Name is required"),
  type:      z.enum(["estimate_follow_up","job_scheduled","job_reminder","payment_reminder","review_request","custom"]),
  subject:   z.string().optional(),
  body:      z.string().min(1, "Message body is required"),
  is_active: z.boolean(),
})
type FormValues = z.infer<typeof schema>

interface MessageTemplateFormProps {
  userId: string
  template?: MessageTemplate
}

export function MessageTemplateForm({ userId, template }: MessageTemplateFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name:      template?.name      ?? "",
      type:      template?.type      ?? "custom",
      subject:   template?.subject   ?? "",
      body:      template?.body      ?? "",
      is_active: template?.is_active ?? true,
    },
  })

  const { field: bodyField } = useController({ control: form.control, name: "body" })
  const watchedBody    = useWatch({ control: form.control, name: "body" })
  const watchedSubject = useWatch({ control: form.control, name: "subject" })

  function insertVariable(varKey: string) {
    const placeholder = `{{${varKey}}}`
    const el = bodyRef.current
    if (!el) {
      form.setValue("body", (form.getValues("body") ?? "") + placeholder, { shouldValidate: true })
      return
    }
    const start = el.selectionStart ?? 0
    const end   = el.selectionEnd   ?? 0
    const current = form.getValues("body") ?? ""
    form.setValue("body", current.slice(0, start) + placeholder + current.slice(end), { shouldValidate: true })
    setTimeout(() => {
      el.focus()
      const pos = start + placeholder.length
      el.setSelectionRange(pos, pos)
    }, 0)
  }

  async function onSubmit(values: FormValues) {
    const supabase = createClient()
    const payload = {
      user_id:   userId,
      name:      values.name,
      type:      values.type,
      subject:   values.subject || null,
      body:      values.body,
      is_active: values.is_active,
    }

    const { error } = template
      ? await supabase.from("message_templates").update(payload).eq("id", template.id)
      : await supabase.from("message_templates").insert(payload)

    if (error) {
      toast({ title: "Error saving template", description: error.message, variant: "destructive" })
      return
    }

    toast({ title: template ? "Template updated" : "Template created" })
    router.push("/settings/message-templates")
    router.refresh()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: form fields */}
          <div className="space-y-5">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Template Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name *</FormLabel>
                    <FormControl><Input placeholder="e.g. Estimate Follow-up #1" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Type *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {Object.entries(TEMPLATE_TYPE_LABELS).map(([v, label]) => (
                          <SelectItem key={v} value={v}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="subject" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Subject <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Input placeholder="e.g. Following up on your estimate" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="is_active" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <Select
                      onValueChange={(v) => field.onChange(v === "true")}
                      value={String(field.value)}
                    >
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="true">Active</SelectItem>
                        <SelectItem value="false">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Message Body *</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Variable insertion buttons */}
                <div className="flex flex-wrap gap-1.5">
                  {VARIABLES.map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => insertVariable(key)}
                      className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors border"
                    >
                      {`{{${key}}}`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Click a variable to insert it at the cursor position.</p>

                <FormItem>
                  <FormControl>
                    <Textarea
                      {...bodyField}
                      ref={(el) => {
                        bodyRef.current = el
                        if (typeof bodyField.ref === "function") bodyField.ref(el)
                        else if (bodyField.ref) (bodyField.ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
                      }}
                      placeholder="Hi {{customer_name}}, just following up on your estimate..."
                      className="min-h-[180px] font-mono text-sm"
                    />
                  </FormControl>
                  <FormMessage>{form.formState.errors.body?.message}</FormMessage>
                </FormItem>
              </CardContent>
            </Card>

            <div className="flex gap-2">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {template ? "Save Changes" : "Create Template"}
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/settings/message-templates")}>
                Cancel
              </Button>
            </div>
          </div>

          {/* Right: live preview */}
          <div className="space-y-4">
            <Card className="sticky top-6">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Preview
                  <Badge variant="outline" className="text-xs font-normal">sample data</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {watchedSubject && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Subject</p>
                    <p className="text-sm font-medium">{renderPreview(watchedSubject)}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Message</p>
                  <div className="rounded-lg border bg-muted/30 p-4 min-h-[120px]">
                    {watchedBody ? (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{renderPreview(watchedBody)}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">Start typing your message to see a preview...</p>
                    )}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Variables used in sample:</p>
                  <div className="space-y-1">
                    {VARIABLES.map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-muted-foreground">{`{{${key}}}`}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className="text-foreground">{SAMPLE_DATA[key]}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </Form>
  )
}

// ── Inline list-page actions ──────────────────────────────────────────────────

export function ToggleTemplateButton({ id, isActive }: { id: string; isActive: boolean }) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handle() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("message_templates").update({ is_active: !isActive }).eq("id", id)
    setLoading(false)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
    router.refresh()
  }

  return (
    <Button variant="ghost" size="sm" onClick={handle} disabled={loading} className="text-xs h-7">
      {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : isActive ? "Deactivate" : "Activate"}
    </Button>
  )
}

export function DeleteTemplateButton({ id, name }: { id: string; name: string }) {
  const [loading, setLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleConfirmed() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("message_templates").delete().eq("id", id)
    setLoading(false)
    setConfirmOpen(false)
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return }
    router.refresh()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-destructive"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        aria-label={`Delete template ${name}`}
        title="Delete template"
      >
        {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete "${name}"?`}
        description="This will permanently delete this message template. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleConfirmed}
        loading={loading}
      />
    </>
  )
}
