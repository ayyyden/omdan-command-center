"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectGroup, SelectItem,
  SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  MoreHorizontal, Archive, ArchiveRestore, Trash2,
  Copy, Check, MessageSquare, Loader2,
} from "lucide-react"
import { logCommunication } from "@/lib/log-communication"
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
  jobId: string
  jobTitle: string
  isArchived: boolean
  templates: TemplateShape[]
  data: TemplateData
  logContext: LogContext
}

export function JobMobileActions({ jobId, jobTitle, isArchived, templates, data, logContext }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [archiving, setArchiving]     = useState(false)
  const [deleteOpen, setDeleteOpen]   = useState(false)
  const [deleting, setDeleting]       = useState(false)
  const [tplOpen, setTplOpen]         = useState(false)
  const [selectedId, setSelectedId]   = useState("")
  const [body, setBody]               = useState("")
  const [subject, setSubject]         = useState("")
  const [copied, setCopied]           = useState(false)

  async function handleArchive() {
    setArchiving(true)
    const { error } = await createClient().from("jobs").update({ is_archived: !isArchived }).eq("id", jobId)
    setArchiving(false)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
    toast({ title: isArchived ? "Job restored" : "Job archived" })
    router.push("/jobs"); router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await createClient().from("jobs").delete().eq("id", jobId)
    setDeleting(false)
    if (error) { toast({ title: "Error deleting job", description: error.message, variant: "destructive" }); setDeleteOpen(false); return }
    toast({ title: "Job deleted" })
    router.push("/jobs"); router.refresh()
  }

  async function handleCopy(type: string) {
    const tpl = templates.find((t) => t.type === type)
    if (!tpl) { toast({ title: "No template found", description: `Create a "${type.replace(/_/g, " ")}" template in Settings.`, variant: "destructive" }); return }
    const b = render(tpl.body, data)
    const s = tpl.subject ? render(tpl.subject, data) : null
    try {
      await navigator.clipboard.writeText(s ? `${s}\n\n${b}` : b)
      toast({ title: `Copied: ${tpl.name}` })
      logCommunication({ ...logContext, templateId: tpl.id, type: tpl.type, subject: s, body: b }).catch(() => {})
    } catch { toast({ title: "Copy failed", variant: "destructive" }) }
  }

  function openTemplate() {
    if (!templates.length) return
    const first = templates.find((t) => t.type === "job_reminder") ?? templates[0]
    setSelectedId(first.id)
    setBody(render(first.body, data))
    setSubject(first.subject ? render(first.subject, data) : "")
    setTplOpen(true)
  }

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id); if (!t) return
    setSelectedId(id); setBody(render(t.body, data)); setSubject(t.subject ? render(t.subject, data) : "")
  }

  async function copyTemplate() {
    const text = subject ? `${subject}\n\n${body}` : body
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true); toast({ title: "Copied to clipboard" })
      const tpl = templates.find((t) => t.id === selectedId)
      logCommunication({ ...logContext, templateId: selectedId || undefined, type: tpl?.type ?? "custom", subject: subject || null, body }).catch(() => {})
      setTimeout(() => setCopied(false), 2000)
    } catch { toast({ title: "Copy failed", variant: "destructive" }) }
  }

  const preferred = templates.filter((t) => t.type === "job_reminder")
  const others    = templates.filter((t) => t.type !== "job_reminder")

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2.5" aria-label="More actions">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={() => handleCopy("job_reminder")}>
            <Copy className="w-4 h-4 mr-2" />Copy Job Reminder
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleCopy("payment_reminder")}>
            <Copy className="w-4 h-4 mr-2" />Copy Payment Reminder
          </DropdownMenuItem>
          {templates.length > 0 && (
            <DropdownMenuItem onSelect={openTemplate}>
              <MessageSquare className="w-4 h-4 mr-2" />Use Template…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleArchive} disabled={archiving}>
            {archiving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : isArchived ? <ArchiveRestore className="w-4 h-4 mr-2" /> : <Archive className="w-4 h-4 mr-2" />}
            {isArchived ? "Restore Job" : "Archive Job"}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />Delete Job
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Job?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{jobTitle}"</span> and all its expenses and payments will be permanently deleted.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            {subject && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</p>
                <p className="text-sm font-medium border rounded-md px-3 py-2 bg-muted/30">{subject}</p>
              </div>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</p>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[180px] text-sm" />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setTplOpen(false)}>Close</Button>
            <Button onClick={copyTemplate} disabled={!body}>
              {copied ? <><Check className="w-4 h-4 mr-1.5" />Copied!</> : <><Copy className="w-4 h-4 mr-1.5" />Copy to Clipboard</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
