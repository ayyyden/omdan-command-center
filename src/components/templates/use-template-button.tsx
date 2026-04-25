"use client"

import { useState, useEffect } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { MessageSquare, Copy, Check } from "lucide-react"
import { logCommunication } from "@/lib/log-communication"
import type { LogContext } from "./quick-copy-button"

export interface TemplateData {
  customer_name?: string
  job_title?: string
  estimate_total?: string
  invoice_balance?: string
  scheduled_date?: string
  company_name?: string
  company_phone?: string
  sender_name?: string
  sender_phone?: string
  sender_email?: string
  review_link?: string
}

interface TemplateShape {
  id: string
  name: string
  type: string
  subject: string | null
  body: string
}

const TYPE_LABELS: Record<string, string> = {
  estimate_follow_up: "Estimate Follow-up",
  job_scheduled:      "Job Scheduled",
  job_reminder:       "Job Reminder",
  payment_reminder:   "Payment Reminder",
  review_request:     "Review Request",
  custom:             "Custom",
}

function render(text: string, data: TemplateData): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (data as Record<string, string>)[key] ?? `{{${key}}}`)
}

interface UseTemplateButtonProps {
  templates: TemplateShape[]
  data: TemplateData
  preferredType?: string
  logContext?: LogContext
}

export function UseTemplateButton({ templates, data, preferredType, logContext }: UseTemplateButtonProps) {
  const [open, setOpen]             = useState(false)
  const [selectedId, setSelectedId] = useState<string>("")
  const [body, setBody]             = useState("")
  const [subject, setSubject]       = useState("")
  const [copied, setCopied]         = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    if (!open || templates.length === 0) return
    const first = preferredType
      ? (templates.find((t) => t.type === preferredType) ?? templates[0])
      : templates[0]
    pick(first)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(t: TemplateShape) {
    setSelectedId(t.id)
    setBody(render(t.body, data))
    setSubject(t.subject ? render(t.subject, data) : "")
  }

  function handleSelect(id: string) {
    const t = templates.find((x) => x.id === id)
    if (t) pick(t)
  }

  async function handleCopy() {
    const text = subject ? `${subject}\n\n${body}` : body
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      const tplType = templates.find((t) => t.id === selectedId)?.type
      if (tplType === "review_request") {
        toast({ title: "Review request copied", description: "Follow up with the customer in 2 days." })
      } else {
        toast({ title: "Copied to clipboard" })
      }
      setTimeout(() => setCopied(false), 2000)

      const tpl = templates.find((t) => t.id === selectedId)
      logCommunication({
        ...logContext,
        templateId: selectedId || undefined,
        type:       tpl?.type ?? "custom",
        subject:    subject || null,
        body,
      }).catch(() => {})
    } catch {
      toast({ title: "Copy failed — please copy manually", variant: "destructive" })
    }
  }

  if (templates.length === 0) return null

  const preferred = preferredType ? templates.filter((t) => t.type === preferredType) : []
  const others    = preferredType ? templates.filter((t) => t.type !== preferredType) : templates

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <MessageSquare className="w-4 h-4" />
        Use Template
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Use Message Template</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 pt-1">
            <Select value={selectedId} onValueChange={handleSelect}>
              <SelectTrigger>
                <SelectValue placeholder="Select a template…" />
              </SelectTrigger>
              <SelectContent>
                {preferred.length > 0 ? (
                  <>
                    <SelectGroup>
                      <SelectLabel>Suggested</SelectLabel>
                      {preferred.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectGroup>
                    {others.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Other Templates</SelectLabel>
                        {others.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                            <span className="text-muted-foreground text-xs ml-1">· {TYPE_LABELS[t.type] ?? t.type}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                      <span className="text-muted-foreground text-xs ml-1">· {TYPE_LABELS[t.type] ?? t.type}</span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>

            {subject && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/30">{subject}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Message <span className="normal-case font-normal">(edit before copying)</span>
              </p>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="min-h-[200px] text-sm"
                placeholder="Select a template above…"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Close</Button>
            <Button onClick={handleCopy} disabled={!body}>
              {copied
                ? <><Check className="w-4 h-4 mr-1.5" />Copied!</>
                : <><Copy className="w-4 h-4 mr-1.5" />Copy to Clipboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
