"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { MoreHorizontal, Trash2, Eye, Download, Send, Loader2, CopyPlus } from "lucide-react"
import { logActivity } from "@/lib/activity"

interface TemplateShape {
  id: string; name: string; type: string; subject: string | null; body: string
}

function render(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? `{{${k}}}`)
}

interface Props {
  estimateId: string
  estimateTitle: string
  estimateStatus: string
  userId: string
  customerEmail: string | null
  customerName: string
  templates: TemplateShape[]
  tplData: Record<string, string>
  logContext: { customerId?: string; estimateId?: string }
}

export function EstimateMobileActions({
  estimateId, estimateTitle, estimateStatus, userId,
  customerEmail, customerName, templates, tplData,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sendOpen, setSendOpen]     = useState(false)
  const [sending, setSending]       = useState(false)
  const [revising, setRevising]     = useState(false)

  const followUpTpl = templates.find((t) => t.type === "estimate_follow_up")
  const [to, setTo]               = useState(customerEmail ?? "")
  const [sendSubject, setSendSubject] = useState(
    followUpTpl?.subject ? render(followUpTpl.subject, tplData) : `Estimate for ${customerName}: ${estimateTitle}`
  )
  const [sendBody, setSendBody] = useState(followUpTpl ? render(followUpTpl.body, tplData) : "")

  async function generatePdf(): Promise<string | null> {
    setGenerating(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/pdf`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "PDF failed", description: (err as any).error ?? "Unknown error", variant: "destructive" })
        return null
      }
      return ((await res.json()) as { url: string }).url
    } catch {
      toast({ title: "PDF failed", description: "Network error", variant: "destructive" })
      return null
    } finally {
      setGenerating(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await createClient().from("estimates").delete().eq("id", estimateId)
    setDeleting(false)
    if (error) {
      toast({ title: "Error deleting estimate", description: error.message, variant: "destructive" })
      setDeleteOpen(false)
      return
    }
    toast({ title: "Estimate deleted" })
    router.push("/estimates")
    router.refresh()
  }

  async function handleRevise() {
    setRevising(true)
    const supabase = createClient()
    const { data: orig, error: fe } = await supabase.from("estimates").select("*").eq("id", estimateId).single()
    if (fe || !orig) {
      toast({ title: "Could not load estimate", variant: "destructive" })
      setRevising(false)
      return
    }
    const baseTitle = orig.title.replace(/ \(Revised\)$/, "")
    const { data: newEst, error: ie } = await supabase.from("estimates").insert({
      user_id: userId, customer_id: orig.customer_id, title: `${baseTitle} (Revised)`,
      scope_of_work: orig.scope_of_work, line_items: orig.line_items,
      markup_percent: orig.markup_percent, tax_percent: orig.tax_percent,
      subtotal: orig.subtotal, markup_amount: orig.markup_amount, tax_amount: orig.tax_amount,
      total: orig.total, notes: orig.notes, status: "draft", revised_from_id: estimateId,
    }).select("id").single()
    if (ie || !newEst) {
      toast({ title: "Failed to create revision", variant: "destructive" })
      setRevising(false)
      return
    }
    await logActivity(supabase, {
      userId, entityType: "estimate", entityId: newEst.id, action: "created",
      description: `Draft revision created from rejected estimate "${orig.title}"`,
    })
    toast({ title: "Revision created", description: "Opening new draft…" })
    router.push(`/estimates/${newEst.id}/edit`)
  }

  async function handleSend() {
    if (!to) { toast({ title: "Recipient email required", variant: "destructive" }); return }
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: sendSubject, body: sendBody }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast({ title: "Failed to send", description: (d as any).error ?? "Unknown error", variant: "destructive" })
        return
      }
      toast({ title: "Estimate sent", description: `Email sent to ${to}` })
      setSendOpen(false)
    } catch {
      toast({ title: "Failed to send", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2.5" aria-label="More actions" disabled={generating || revising}>
            {(generating || revising) ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {estimateStatus === "rejected" && (
            <DropdownMenuItem onSelect={handleRevise} disabled={revising}>
              <CopyPlus className="w-4 h-4 mr-2" />Revise Estimate
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setSendOpen(true)}>
            <Send className="w-4 h-4 mr-2" />Send via Email…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => { const u = await generatePdf(); if (u) window.open(u, "_blank") }}>
            <Eye className="w-4 h-4 mr-2" />Preview PDF
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={async () => {
            const u = await generatePdf(); if (!u) return
            const a = document.createElement("a"); a.href = u; a.download = `estimate-${estimateId.slice(0, 8)}.pdf`; a.click()
          }}>
            <Download className="w-4 h-4 mr-2" />Download PDF
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />Delete Estimate
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Delete confirm */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Estimate?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{estimateTitle}"</span> will be permanently deleted.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send dialog */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Send Estimate</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
              {!customerEmail && <p className="text-xs text-warning">No email on file — enter one above.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
              <Textarea value={sendBody} onChange={(e) => setSendBody(e.target.value)} className="min-h-[140px] text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">The estimate PDF will be generated and attached automatically.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !to || !sendBody}>
              {sending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : <><Send className="w-4 h-4 mr-1.5" />Send Estimate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
