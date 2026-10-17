"use client"

import { useEffect, useMemo, useState } from "react"
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
  /** One document, or several sent together as one signing link (in this order) */
  documents: DocumentSummary[] | null
  userId: string
  companyName: string | null
  onClose: () => void
  /** Customer/job already known (e.g. sending from a Job page) — skips picking a recipient */
  preset?: { customerId: string; jobId: string | null; recipientEmail: string; label: string }
}

type Mode = "loading" | "prepare" | "choose" | "send" | "sign"

// Staff side of sending: for each document that has staff-owned fields
// (Sales Person Signature, price, license #…), fill your part first — one
// document after another — then Sign Now (hand the device to the customer)
// or Send by Email. Several documents go out as ONE link: the customer
// agrees to e-signing once and signs them in order, each shown already
// filled with your part (see sign-bundle).
export function DocumentActionSheet({ documents, userId, companyName, onClose, preset }: Props) {
  const { toast } = useToast()
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>("loading")
  const [staffFieldsByDoc, setStaffFieldsByDoc] = useState<Record<string, FormField[]>>({})
  const [staffValues, setStaffValues] = useState<Record<string, Record<string, string>>>({})
  const [prepareIdx, setPrepareIdx] = useState(0)
  const [selection, setSelection] = useState<RecipientSelection | null>(preset ? { customerId: preset.customerId, jobId: preset.jobId, recipientEmail: preset.recipientEmail } : null)
  const [presetEmail, setPresetEmail] = useState(preset?.recipientEmail ?? "")
  useEffect(() => {
    if (preset) setSelection(presetEmail.trim() ? { customerId: preset.customerId, jobId: preset.jobId, recipientEmail: presetEmail.trim() } : null)
  }, [preset, presetEmail])
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [submitting, setSubmitting] = useState(false)

  const docs = useMemo(() => documents ?? [], [documents])
  const multi = docs.length > 1
  const needsPrep = docs.filter((d) => (staffFieldsByDoc[d.id] ?? []).length > 0)
  const anySignature = docs.some((d) => d.requiresSignature)
  const title = multi ? `${docs.length} documents` : docs[0]?.name

  // Staff-owned fields for every document (and its paired back page)
  useEffect(() => {
    if (!docs.length) return
    let cancelled = false
    setMode("loading")
    const templateToDoc = new Map<string, string>()
    for (const d of docs) {
      templateToDoc.set(d.id, d.id)
      if (d.pairedTemplateId) templateToDoc.set(d.pairedTemplateId, d.id)
    }
    supabase
      .from("contract_fields")
      .select("id, page_number, field_type, label, required, contract_template_id")
      .in("contract_template_id", [...templateToDoc.keys()])
      .eq("fill_role", "staff")
      .order("page_number")
      .then(({ data }) => {
        if (cancelled) return
        const byDoc: Record<string, FormField[]> = {}
        for (const f of (data ?? []) as (FormField & { contract_template_id: string })[]) {
          const docId = templateToDoc.get(f.contract_template_id)!
          ;(byDoc[docId] ??= []).push(f)
        }
        setStaffFieldsByDoc(byDoc)
        setPrepareIdx(0)
        setMode(docs.some((d) => (byDoc[d.id] ?? []).length) ? "prepare" : "choose")
      })
    return () => { cancelled = true }
  }, [docs]) // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setMode("loading")
    setStaffFieldsByDoc({})
    setStaffValues({})
    setPrepareIdx(0)
    setSelection(preset ? { customerId: preset.customerId, jobId: preset.jobId, recipientEmail: preset.recipientEmail } : null)
    setPresetEmail(preset?.recipientEmail ?? "")
    setSubject("")
    setBody("")
  }

  function handleClose() {
    if (submitting) return
    onClose()
    setTimeout(reset, 200)
  }

  const payload = () => docs.map((d) => ({ templateId: d.id, staffFieldValues: staffValues[d.id] ?? null }))

  function startSend() {
    setMode("send")
    setSubject(multi ? `Documents from ${companyName ?? "us"}: please review and sign` : docs[0]?.name ?? "")
    setBody(
      multi
        ? `Hi,\n\nPlease review and sign the ${docs.length} documents below. They're already filled in on our end; you'll go through them one after another.\n\nThank you!\n\n${companyName ?? ""}`.trim()
        : `Hi,\n\nPlease find your document attached${docs[0]?.requiresSignature ? " — click the link below to review and sign electronically" : ""}.\n\nThank you!\n\n${companyName ?? ""}`.trim(),
    )
  }

  async function handleSend() {
    if (!docs.length || !selection || !subject || !body) return
    setSubmitting(true)
    const res = await fetch("/api/contracts/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: payload(), customerId: selection.customerId, jobId: selection.jobId,
        recipientEmail: selection.recipientEmail, subject, body,
      }),
    })
    setSubmitting(false)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Send failed", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }
    toast({ title: "Sent", description: `${title} sent to ${selection.recipientEmail}` })
    handleClose()
  }

  async function handleSignNow() {
    if (!docs.length || !selection) return
    setSubmitting(true)
    const res = await fetch("/api/contracts/sign-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documents: payload(), customerId: selection.customerId, jobId: selection.jobId,
        recipientEmail: selection.recipientEmail,
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

  const prepDoc = needsPrep[prepareIdx]

  return (
    <Dialog open={!!documents?.length} onOpenChange={(o) => { if (!o) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {(mode === "send" || mode === "sign") && (
              <button type="button" onClick={() => setMode("choose")} className="text-muted-foreground hover:text-foreground -ml-1" aria-label="Back">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
        </DialogHeader>

        {mode === "loading" && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        )}

        {mode === "prepare" && prepDoc && (
          <div className="space-y-3">
            {needsPrep.length > 1 && (
              <p className="text-xs font-medium text-muted-foreground">
                Your part · document {prepareIdx + 1} of {needsPrep.length}
              </p>
            )}
            <StaffPrepareForm
              key={prepDoc.id}
              documentName={prepDoc.name}
              fields={staffFieldsByDoc[prepDoc.id] ?? []}
              initialValues={staffValues[prepDoc.id]}
              onContinue={({ fieldValues }) => {
                setStaffValues((v) => ({ ...v, [prepDoc.id]: fieldValues }))
                if (prepareIdx + 1 < needsPrep.length) setPrepareIdx(prepareIdx + 1)
                else setMode("choose")
              }}
            />
          </div>
        )}

        {mode === "choose" && (
          <div className="space-y-2 pt-1">
            {multi && (
              <ol className="rounded-lg border divide-y mb-2">
                {docs.map((d, i) => {
                  const hasPrep = (staffFieldsByDoc[d.id] ?? []).length > 0
                  return (
                    <li key={d.id} className="flex items-center gap-2.5 px-3 py-2 text-sm">
                      <span className="w-5 text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                      <span className="flex-1 min-w-0 truncate">{d.name}</span>
                      {hasPrep ? (
                        <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline"
                          onClick={() => { setPrepareIdx(needsPrep.findIndex((x) => x.id === d.id)); setMode("prepare") }}>
                          Edit your part
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">nothing to fill</span>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
            {!multi && needsPrep.length > 0 && (
              <p className="text-xs text-muted-foreground pb-1">
                Your part is filled in.{" "}
                <button type="button" className="underline hover:text-foreground" onClick={() => { setPrepareIdx(0); setMode("prepare") }}>Edit</button>
              </p>
            )}
            {anySignature && (
              <button type="button" onClick={() => setMode("sign")}
                className="w-full flex items-center gap-3 rounded-lg border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors px-4 py-3.5 text-left">
                <FileSignature className="w-5 h-5 text-blue-600 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-900">Sign Now</p>
                  <p className="text-xs text-slate-500">Hand this device to the customer to sign {multi ? "them all" : ""} in person</p>
                </div>
              </button>
            )}
            <button type="button" onClick={startSend}
              className="w-full flex items-center gap-3 rounded-lg border-2 border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 transition-colors px-4 py-3.5 text-left">
              <Send className="w-5 h-5 text-blue-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-900">Send by Email</p>
                <p className="text-xs text-slate-500">
                  {multi ? "One link: they agree once, then sign each document in order" : anySignature ? "Email a secure signing link" : "Email the document as-is"}
                </p>
              </div>
            </button>
            {docs.some((d) => d.hasPairedDoc) && (
              <p className="text-xs text-muted-foreground pt-1">Paired back pages are attached automatically.</p>
            )}
          </div>
        )}

        {mode === "sign" && (
          <div className="space-y-4 pt-1">
            {preset ? (
              <div className="space-y-1.5">
                <Label>To: {preset.label}</Label>
                <Input type="email" value={presetEmail} onChange={(e) => setPresetEmail(e.target.value)} placeholder="customer@email.com" />
              </div>
            ) : (
              <RecipientPicker userId={userId} onChange={setSelection} />
            )}
            <Button onClick={handleSignNow} disabled={!selection || submitting} className="w-full gap-1.5">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
              {submitting ? "Preparing…" : "Begin Signing"}
            </Button>
          </div>
        )}

        {mode === "send" && (
          <div className="space-y-4 pt-1 max-h-[65vh] overflow-y-auto pr-1">
            {preset ? (
              <div className="space-y-1.5">
                <Label>To: {preset.label}</Label>
                <Input type="email" value={presetEmail} onChange={(e) => setPresetEmail(e.target.value)} placeholder="customer@email.com" />
              </div>
            ) : (
              <RecipientPicker userId={userId} onChange={setSelection} />
            )}
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
              {submitting ? "Sending…" : multi ? `Send ${docs.length} documents` : "Send"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

