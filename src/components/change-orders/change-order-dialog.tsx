"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus, Send, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface Props {
  jobId: string
  customerName: string
  customerEmail: string | null
  companyName: string | null
}

export function NewChangeOrderDialog({ jobId, customerName, customerEmail, companyName }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title:       "",
    description: "",
    amount:      "",
    notes:       "",
    to:          customerEmail ?? "",
  })

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function reset() {
    setForm({ title: "", description: "", amount: "", notes: "", to: customerEmail ?? "" })
    setError(null)
  }

  function buildEmailBody() {
    const fmtAmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
      parseFloat(form.amount) || 0,
    )
    return `Hi ${customerName},

We'd like to propose an additional change to your project.

Change Order: ${form.title}
Additional Amount: ${fmtAmt}${form.description ? `\n\nDetails: ${form.description}` : ""}

Please review and approve using the link below.

Thank you,
${companyName ?? "Our Team"}`
  }

  async function save(sendEmail: boolean) {
    if (!form.title.trim() || !form.amount) return
    if (sendEmail && !form.to.trim()) { setError("Customer email is required to send."); return }

    setSaving(true)
    setError(null)

    try {
      const createRes = await fetch("/api/change-orders", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id:      jobId,
          title:       form.title.trim(),
          description: form.description.trim() || null,
          amount:      parseFloat(form.amount),
          notes:       form.notes.trim() || null,
        }),
      })
      const { data: co, error: createErr } = await createRes.json()
      if (!createRes.ok || !co) throw new Error(createErr ?? "Failed to create change order")

      if (sendEmail) {
        const sendRes = await fetch(`/api/change-orders/${co.id}/send`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to:      form.to.trim(),
            subject: `Change Order: ${form.title.trim()}`,
            body:    buildEmailBody(),
          }),
        })
        if (!sendRes.ok) {
          const { error: sendErr } = await sendRes.json()
          throw new Error(sendErr ?? "Change order saved but email failed to send")
        }
      }

      setOpen(false)
      reset()
      router.refresh()
    } catch (err: any) {
      setError(err.message ?? "Something went wrong")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Plus className="w-4 h-4" />
          New Change Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Change Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Title *</Label>
            <Input
              placeholder="e.g. Additional drywall repair"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Describe the additional work…"
              rows={3}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Amount *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="pl-7"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Internal Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Textarea
              placeholder="Notes for your records…"
              rows={2}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>

          <div className="border-t pt-4 space-y-1.5">
            <Label>Customer Email <span className="text-muted-foreground font-normal">(required to send)</span></Label>
            <Input
              type="email"
              placeholder="customer@example.com"
              value={form.to}
              onChange={(e) => set("to", e.target.value)}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              disabled={saving || !form.title.trim() || !form.amount}
              onClick={() => save(false)}
              className="flex-1"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin mr-1.5" />}
              Save Draft
            </Button>
            <Button
              disabled={saving || !form.title.trim() || !form.amount || !form.to.trim()}
              onClick={() => save(true)}
              className="flex-1 gap-1.5"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
              Save & Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
