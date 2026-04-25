"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Send } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Customer {
  id: string
  name: string
  email: string | null
}

interface Template {
  id: string
  name: string
  subject: string | null
  body: string
}

interface ContractTemplate {
  id: string
  name: string
}

interface JobOption {
  id: string
  title: string
  pm_name: string | null
  pm_email: string | null
}

interface CompanySettings {
  company_name: string | null
  email: string | null
}

interface Props {
  contract: ContractTemplate
  customers: Customer[]
  templates: Template[]
  companySettings: CompanySettings | null
  userId: string
}

function interpolate(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? `{{${k}}}`)
}

export function SendContractDialog({
  contract,
  customers,
  templates,
  companySettings,
  userId,
}: Props) {
  const { toast } = useToast()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [customerId, setCustomerId] = useState("none")
  const [jobId, setJobId] = useState("none")
  const [recipientEmail, setRecipientEmail] = useState("")
  const [subject, setSubject] = useState(`${contract.name}`)
  const [body, setBody] = useState("")
  const [senderName, setSenderName] = useState(companySettings?.company_name ?? "")
  const [tplId, setTplId] = useState("none")
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [loadingJobs, setLoadingJobs] = useState(false)
  const [sending, setSending] = useState(false)

  // Fetch jobs when customer changes
  useEffect(() => {
    if (!customerId || customerId === "none") {
      setJobs([])
      setJobId("none")
      return
    }
    setLoadingJobs(true)
    setJobId("none")
    supabase
      .from("jobs")
      .select("id, title, project_manager:project_managers(name, email)")
      .eq("customer_id", customerId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setJobs(
          (data ?? []).map((j) => ({
            id: j.id,
            title: j.title,
            pm_name: (j.project_manager as any)?.name ?? null,
            pm_email: (j.project_manager as any)?.email ?? null,
          }))
        )
        setLoadingJobs(false)
      })
  }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill email when customer selected
  useEffect(() => {
    const c = customers.find((c) => c.id === customerId)
    setRecipientEmail(c?.email ?? "")
    setSenderName(companySettings?.company_name ?? "")
  }, [customerId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update sender when job selected (use PM if available)
  useEffect(() => {
    if (!jobId || jobId === "none") {
      setSenderName(companySettings?.company_name ?? "")
      return
    }
    const j = jobs.find((j) => j.id === jobId)
    setSenderName(j?.pm_name ?? companySettings?.company_name ?? "")
  }, [jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Apply template
  useEffect(() => {
    if (!tplId || tplId === "none") return
    const tpl = templates.find((t) => t.id === tplId)
    if (!tpl) return
    const customer = customers.find((c) => c.id === customerId)
    const job = jobs.find((j) => j.id === jobId)
    const data = {
      customer_name:  customer?.name      ?? "",
      contract_name:  contract.name,
      company_name:   companySettings?.company_name ?? "",
      sender_name:    senderName,
      job_title:      job?.title          ?? "",
    }
    if (tpl.subject) setSubject(interpolate(tpl.subject, data))
    setBody(interpolate(tpl.body, data))
  }, [tplId]) // eslint-disable-line react-hooks/exhaustive-deps

  function resetForm() {
    setCustomerId("none")
    setJobId("none")
    setRecipientEmail("")
    setSubject(contract.name)
    setBody("")
    setSenderName(companySettings?.company_name ?? "")
    setTplId("none")
    setJobs([])
  }

  async function handleSend() {
    if (!customerId || customerId === "none" || !recipientEmail || !subject || !body) return
    setSending(true)

    const res = await fetch("/api/contracts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId:     contract.id,
        customerId,
        jobId:          jobId === "none" ? null : jobId,
        recipientEmail,
        subject,
        body,
      }),
    })

    setSending(false)

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Send failed", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }

    toast({ title: "Contract sent", description: `Sent to ${recipientEmail}` })
    setOpen(false)
    resetForm()
  }

  const selectedCustomer = customerId !== "none" ? customers.find((c) => c.id === customerId) : undefined

  return (
    <>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setOpen(true)}>
        <Send className="w-3.5 h-3.5" />
        Send
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o && !sending) { setOpen(false); resetForm() }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send Contract: {contract.name}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Customer */}
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>Select customer…</SelectItem>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Job (optional) */}
            {customerId !== "none" && (
              <div className="space-y-1.5">
                <Label>Job (optional)</Label>
                <Select
                  value={jobId}
                  onValueChange={setJobId}
                  disabled={loadingJobs}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={loadingJobs ? "Loading…" : "No specific job"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No specific job</SelectItem>
                    {jobs.map((j) => (
                      <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Recipient email */}
            <div className="space-y-1.5">
              <Label>Recipient Email *</Label>
              <Input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="customer@email.com"
              />
            </div>

            {/* Message template */}
            {templates.length > 0 && (
              <div className="space-y-1.5">
                <Label>Message Template (optional)</Label>
                <Select value={tplId} onValueChange={setTplId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose template to pre-fill…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No template</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Subject */}
            <div className="space-y-1.5">
              <Label>Subject *</Label>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label>Message *</Label>
              <Textarea
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Write your message here…"
              />
            </div>

            {/* Sender info */}
            {senderName && (
              <p className="text-xs text-muted-foreground">
                Sending as: <span className="font-medium">{senderName}</span>
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setOpen(false); resetForm() }}
              disabled={sending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || !customerId || customerId === "none" || !recipientEmail || !subject || !body}
              className="gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {sending ? "Sending…" : "Send Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
