"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { RecipientPicker, type RecipientSelection } from "./recipient-picker"
import { StaffPrepareForm } from "./staff-prepare-form"
import type { FormField } from "./field-row"
import { createClient } from "@/lib/supabase/client"
import { FileSignature, Send, Loader2, ChevronLeft } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export interface DocumentSummary {
  id: string
  name: string
  requiresSignature: boolean
  hasPairedDoc: boolean
  pairedTemplateId: string | null
}

interface Props {
  document: DocumentSummary | null
  userId: string
  companyName: string | null
  onClose: () => void
}

type Mode = "loading" | "prepare" | "choose" | "send" | "sign"

export function DocumentActionSheet({ document, userId, companyName, onClose }: Props) {
  const { toast } = useToast()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>("loading")
  const [staffFields, setStaffFields] = useState<FormField[]>([])
  const [staffFieldValues, setStaffFieldValues] = useState<Record<string, string>>({})
  const [selection, setSelection] = useState<RecipientSelection | null>(null)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)

  // Fetch staff-owned fields (for this template and its paired child, if
  // any) whenever a document is opened — decides whether a Prepare step is
  // needed before Sign Now / Send are even offered.
  useEffect(() => {
    if (!document) return
    let cancelled = false
    setMode("loading")
    const templateIds = [document.id, document.pairedTemplateId].filter(Boolean) as string[]
    supabase
      .from("contract_fields")
      .select("id, page_number, field_type, label, required")
      .in("contract_template_id", templateIds)
      .eq("fill_role", "staff")
      .order("page_number")
      .then(({ data }) => {
        if (cancelled) return
        const fields = (data ?? []) as FormField[]
        setStaffFields(fields)
        setMode(fields.length > 0 ? "prepare" : "choose")
      })
    return () => { cancelled = true }
  }, [document]) // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setMode("loading")
    setStaffFields([])
    setStaffFieldValues({})
    setSelection(null)
    setSubject("")
    setBody("")
  }

  function handleClose() {
    if (submitting) return
    onClose()
    setTimeout(reset, 200)
  }

  function startSend() {
    setMode("send")
    setSubject(document?.name ?? "")
    setBody(`Hi,\n\nPlease find your document attached${document?.requiresSignature ? " — click the link below to review and sign electronically" : ""}.\n\nThank you!\n\n${companyName ?? ""}`.trim())
  }

  async function handleSend() {
    if (!document || !selection || !subject || !body) return
    setSubmitting(true)
    const res = await fetch("/api/contracts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId: document.id, customerId: selection.customerId, jobId: selection.jobId,
        recipientEmail: selection.recipientEmail, subject, body,
        staffFieldValues: Object.keys(staffFieldValues).length ? staffFieldValues : undefined,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Send failed", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }
    toast({ title: "Sent", description: `${document.name} sent to ${selection.recipientEmail}` })
    handleClose()
  }

  async function handleSignNow() {
    if (!document || !selection) return
    setSubmitting(true)
    const res = await fetch("/api/contracts/sign-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId: document.id, customerId: selection.customerId, jobId: selection.jobId,
        recipientEmail: selection.recipientEmail,
        staffFieldValues: Object.keys(staffFieldValues).length ? staffFieldValues : undefined,
      }),
    })
    if (!res.ok) {
      setSubmitting(false)
      const err = await res.json().catch(() => ({}))
      toast({ title: "Could not start signing", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }
    const { token, isBundle } = await res.json()
    window.location.href = isBundle ? `/sign-bundle/${token}` : `/sign-contract/${token}`
  }

  return (
    <Dialog open={!!document} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {(mode === "send" || mode === "sign") && (
              <button
                type="button"
                onClick={() => setMode("choose")}
                className="text-muted-foreground hover:text-foreground -ml-1"
                aria-label="Back"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <DialogTitle>{document?.name}</DialogTitle>
          </div>
        </DialogHeader>

        {mode === "loading" && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {mode === "prepare" && document && (
          <StaffPrepareForm
            documentName={document.name}
            fields={staffFields}
            onContinue={({ fieldValues }) => {
              setStaffFieldValues(fieldValues)
              setMode("choose")
            }}
          />
        )}

        {mode === "choose" && (
          <div className="space-y-2 pt-1">
            {staffFields.length > 0 && (
              <p className="text-xs text-muted-foreground pb-1">
                Your part is filled in.{" "}
                <button type="button" className="underline hover:text-foreground" onClick={() => setMode("prepare")}>
                  Edit
                </button>
              </p>
            )}
            {document?.requiresSignature && (
              <button
                type="button"
                onClick={() => setMode("sign")}
                className="w-full flex items-center gap-3 rounded-lg border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors px-4 py-3.5 text-left"
              >
                <FileSignature className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Sign Now</p>
                  <p className="text-xs text-slate-500">Hand this device to the customer to sign in person</p>
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={startSend}
              className="w-full flex items-center gap-3 rounded-lg border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors px-4 py-3.5 text-left"
            >
              <Send className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Send by Email</p>
                <p className="text-xs text-slate-500">
                  {document?.requiresSignature ? "Email a secure signing link" : "Email the document as-is"}
                </p>
              </div>
            </button>
            {document?.hasPairedDoc && (
              <p className="text-xs text-muted-foreground pt-1">
                The paired back page is attached automatically — no need to select it separately.
              </p>
            )}
          </div>
        )}

        {mode === "sign" && (
          <div className="space-y-4 pt-1">
            <RecipientPicker userId={userId} onChange={setSelection} />
            <Button onClick={handleSignNow} disabled={!selection || submitting} className="w-full gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
              {submitting ? "Preparing…" : "Begin Signing"}
            </Button>
          </div>
        )}

        {mode === "send" && (
          <div className="space-y-4 pt-1 max-h-[65vh] overflow-y-auto pr-1">
            <RecipientPicker userId={userId} onChange={setSelection} />
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Message</Label>
              <Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <Button onClick={handleSend} disabled={!selection || !subject || !body || submitting} className="w-full gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {submitting ? "Sending…" : "Send"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
