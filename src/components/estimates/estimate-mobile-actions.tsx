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
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  MoreHorizontal, Trash2, Eye, Download, Send, Copy, Check,
  MessageSquare, Loader2, CopyPlus,
} from "lucide-react"
import { logCommunication } from "@/lib/log-communication"
import { logActivity } from "@/lib/activity"
import type { TemplateData } from "@/components/templates/use-template-button"
import type { LogContext } from "@/components/templates/quick-copy-button"

const TYPE_LABELS: Record<string, string> = {
  estimate_follow_up: "Estimate Follow-up",
  job_scheduled:      "Job Scheduled",
  job_reminder:       "Job Reminder",
  payment_reminder:   "Payment Reminder",
  review_request:     "Review Request",
  custom:             "Custom",
}

interface TemplateShape {
  id: string; name: string; type: string; subject: string | null; body: string
}

function render(text: string, data: TemplateData): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => (data as Record<string, string>)[k] ?? `{{${k}}}`)
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
  logContext: LogContext
}

export function EstimateMobileActions({
  estimateId, estimateTitle, estimateStatus, userId,
  customerEmail, customerName, templates, tplData, logContext,
}: Props) {
  const router = useRouter()
  const { toast } = useToast()

  const [deleteOpen, setDeleteOpen]   = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [generating, setGenerating]   = useState(false)
  const [sendOpen, setSendOpen]       = useState(false)
  const [sending, setSending]         = useState(false)
  const [revising, setRevising]       = useState(false)
  const [tplOpen, setTplOpen]         = useState(false)
  const [selectedId, setSelectedId]   = useState("")
  const [tplBody, setTplBody]         = useState("")
  const [tplSubject, setTplSubject]   = useState("")
  const [copied, setCopied]           = useState(false)

  const followUpTpl = templates.find((t) => t.type === "estimate_follow_up")
  const [to, setTo]           = useState(customerEmail ?? "")
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
    } catch { toast({ title: "PDF failed", description: "Network error", variant: "destructive" }); return null }
    finally { setGenerating(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await createClient().from("estimates").delete().eq("id", estimateId)
    setDeleting(false)
    if (error) { toast({ title: "Error deleting estimate", description: error.message, variant: "destructive" }); setDeleteOpen(false); return }
    toast({ title: "Estimate deleted" }); router.push("/estimates"); router.refresh()
  }

  async function handleRevise() {
    setRevising(true)
    const supabase = createClient()
    const { data: orig, error: fe } = await supabase.from("estimates").select("*").eq("id", estimateId).single()
    if (fe || !orig) { toast({ title: "Could not load estimate", variant: "destructive" }); setRevising(false); return }
    const baseTitle = orig.title.replace(/ \(Revised\)$/, "")
    const { data: newEst, error: ie } = await supabase.from("estimates").insert({
      user_id: userId, customer_id: orig.customer_id, title: `${baseTitle} (Revised)`,
      scope_of_work: orig.scope_of_work, line_items: orig.line_items,
      markup_percent: orig.markup_percent, tax_percent: orig.tax_percent,
      subtotal: orig.subtotal, markup_amount: orig.markup_amount, tax_amount: orig.tax_amount,
      total: orig.total, notes: orig.notes, status: "draft", revised_from_id: estimateId,
    }).select("id").single()
    if (ie || !newEst) { toast({ title: "Failed to create revision", variant: "destructive" }); setRevising(false); return }
    await logActivity(supabase, { userId, entityType: "estimate", entityId: newEst.id, action: "created", description: `Draft revision created from rejected estimate "${orig.title}"` })
    toast({ title: "Revision created", description: "Opening new draft…" })
    router.push(`/estimates/${newEst.id}/edit`)
  }

  async function handleSend() {
    if (!to) { toast({ title: "Recipient email required", variant: "destructive" }); return }
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: sendSubject, body: sendBody }),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); toast({ title: "Failed to send", description: (d as any).error ?? "Unknown error", variant: "destructive" }); return }
      toast({ title: "Estimate sent", description: `Email sent to ${to}` }); setSendOpen(false)
    } catch { toast({ title: "Failed to send", description: "Network error", variant: "destructive" })
    } finally { setSending(false) }
  }

  async function handleCopy(type: string) {
    const tpl = templates.find((t) => t.type === type)
    if (!tpl) { toast({ title: "No template found", variant: "destructive" }); return }
    const b = render(tpl.body, tplData), s = tpl.subject ? render(tpl.subject, tplData) : null
    try {
      await navigator.clipboard.writeText(s ? `${s}\n\n${b}` : b)
      toast({ title: `Copied: ${tpl.name}` })
      logCommunication({ ...logContext, templateId: tpl.id, type: tpl.type, subject: s, body: b }).catch(() => {})
    } catch { toast({ title: "Copy failed", variant: "destructive" }) }
  }

  function openTemplate() {
    if (!templates.length) return
    const first = templates.find((t) => t.type === "estimate_follow_up") ?? templates[0]
    setSelectedId(first.id); setTplBody(render(first.body, tplData))
    setTplSubject(first.subject ? render(first.subject, tplData) : ""); setTplOpen(true)
  }

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id); if (!t) return
    setSelectedId(id); setTplBody(render(t.body, tplData)); setTplSubject(t.subject ? render(t.subject, tplData) : "")
  }

  async function copyTemplate() {
    const text = tplSubject ? `${tplSubject}\n\n${tplBody}` : tplBody
    try {
      await navigator.clipboard.writeText(text); setCopied(true); toast({ title: "Copied to clipboard" })
      const tpl = templates.find((t) => t.id === selectedId)
      logCommunication({ ...logContext, templateId: selectedId || undefined, type: tpl?.type ?? "custom", subject: tplSubject || null, body: tplBody }).catch(() => {})
      setTimeout(() => setCopied(false), 2000)
    } catch { toast({ title: "Copy failed", variant: "destructive" }) }
  }

  const preferred = templates.filter((t) => t.type === "estimate_follow_up")
  const others    = templates.filter((t) => t.type !== "estimate_follow_up")

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2.5" aria-label="More actions" disabled={generating || revising}>
            {(generating || revising) ? <Loader2 className="w-4 h-4 animate-spin" /> : <MoreHorizontal className="w-4 h-4" />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
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
          <DropdownMenuItem onSelect={() => handleCopy("estimate_follow_up")}>
            <Copy className="w-4 h-4 mr-2" />Copy Follow-up
          </DropdownMenuItem>
          {templates.length > 0 && (
            <DropdownMenuItem onSelect={openTemplate}>
              <MessageSquare className="w-4 h-4 mr-2" />Use Template…
            </DropdownMenuItem>
          )}
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

      {/* Use Template dialog */}
      <Dialog open={tplOpen} onOpenChange={setTplOpen}>
        <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Use Message Template</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <Select value={selectedId} onValueChange={pickTemplate}>
              <SelectTrigger><SelectValue placeholder="Select a template…" /></SelectTrigger>
              <SelectContent>
                {preferred.length > 0 ? (
                  <>
                    <SelectGroup><SelectLabel>Suggested</SelectLabel>
                      {preferred.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectGroup>
                    {others.length > 0 && (
                      <SelectGroup><SelectLabel>Other Templates</SelectLabel>
                        {others.map((t) => <SelectItem key={t.id} value={t.id}>{t.name} <span className="text-muted-foreground text-xs">· {TYPE_LABELS[t.type] ?? t.type}</span></SelectItem>)}
                      </SelectGroup>
                    )}
                  </>
                ) : templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {tplSubject && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/30">{tplSubject}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</p>
              <Textarea value={tplBody} onChange={(e) => setTplBody(e.target.value)} className="min-h-[180px] text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTplOpen(false)}>Close</Button>
            <Button onClick={copyTemplate} disabled={!tplBody}>
              {copied ? <><Check className="w-4 h-4 mr-1.5" />Copied!</> : <><Copy className="w-4 h-4 mr-1.5" />Copy to Clipboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
