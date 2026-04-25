"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Download, Eye, Send, Loader2 } from "lucide-react"

interface Template {
  id: string
  type: string
  subject: string | null
  body: string
}

function render(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`)
}

interface PdfActionsProps {
  estimateId: string
  estimateTitle: string
  customerEmail: string | null
  customerName: string
  templates: Template[]
  tplData: Record<string, string>
}

export function PdfActions({
  estimateId,
  estimateTitle,
  customerEmail,
  customerName,
  templates,
  tplData,
}: PdfActionsProps) {
  const { toast } = useToast()

  const [generating, setGenerating] = useState(false)
  const [sendOpen, setSendOpen]     = useState(false)
  const [sending, setSending]       = useState(false)

  // Derive pre-filled send fields from first estimate_follow_up template
  const followUpTpl = templates.find((t) => t.type === "estimate_follow_up")
  const [to,      setTo]      = useState(customerEmail ?? "")
  const [subject, setSubject] = useState(
    followUpTpl?.subject ? render(followUpTpl.subject, tplData) : `Estimate for ${customerName}: ${estimateTitle}`
  )
  const [body, setBody] = useState(
    followUpTpl ? render(followUpTpl.body, tplData) : ""
  )

  async function generateAndGet(): Promise<string | null> {
    setGenerating(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/pdf`, { method: "POST" })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast({ title: "PDF generation failed", description: (err as any).error ?? "Unknown error", variant: "destructive" })
        return null
      }
      const { url } = await res.json()
      return url as string
    } catch {
      toast({ title: "PDF generation failed", description: "Network error", variant: "destructive" })
      return null
    } finally {
      setGenerating(false)
    }
  }

  async function handlePreview() {
    const url = await generateAndGet()
    if (url) window.open(url, "_blank")
  }

  async function handleDownload() {
    const url = await generateAndGet()
    if (!url) return
    const a = document.createElement("a")
    a.href = url
    a.download = `estimate-${estimateId.slice(0, 8)}.pdf`
    a.click()
  }

  async function handleSend() {
    if (!to) {
      toast({ title: "Recipient email is required", variant: "destructive" })
      return
    }
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${estimateId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Failed to send",
          description: (data as any).error ?? "Unknown error",
          variant: "destructive",
        })
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
      <Button variant="outline" size="sm" className="gap-1.5" onClick={handlePreview} disabled={generating}>
        {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
        Preview PDF
      </Button>

      <Button variant="outline" size="sm" className="gap-1.5" onClick={handleDownload} disabled={generating}>
        {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        Download PDF
      </Button>

      <Button size="sm" className="gap-1.5" onClick={() => setSendOpen(true)}>
        <Send className="w-3.5 h-3.5" />
        Save &amp; Send
      </Button>

      {/* ── Send modal ─────────────────────────────────────────────────── */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Estimate</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="customer@example.com"
              />
              {!customerEmail && (
                <p className="text-xs text-warning">No email on file for this customer — enter one above.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Estimate for…"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Message <span className="normal-case font-normal">(edit before sending)</span>
              </label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-[160px] text-sm"
                placeholder="Hi, please find your estimate attached…"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              The estimate PDF will be generated and attached automatically.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={handleSend} disabled={sending || !to || !body}>
              {sending
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
                : <><Send className="w-4 h-4 mr-1.5" />Send Estimate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
