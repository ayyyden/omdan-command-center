"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge }    from "@/components/ui/badge"
import {
  Phone, PhoneCall, PhoneOff, MessageSquare, ThumbsUp, ThumbsDown,
  AlertTriangle, Clock, Ban, CheckCircle2, PhoneForwarded,
} from "lucide-react"
import { SmsModal } from "./sms-modal"

interface LeadPhone {
  id:             string
  phone:          string
  phone_type:     string | null
  is_active:      boolean
  is_wrong_number: boolean
  position:       number
}

interface Lead {
  id:             string
  owner_name:     string | null
  property_address: string | null
  property_city:  string | null
  property_state: string | null
  estimated_value: number | null
  estimated_equity: number | null
  status:         string
  propstream_lead_phones: LeadPhone[]
}

interface Props {
  open:      boolean
  onClose:   () => void
  lead:      Lead
  onOutcome: (leadId: string, newStatus: string) => void
}

type OutcomeType = "no_answer" | "not_interested" | "warm_lead" | "approved" | "do_not_call" | "wrong_number" | "callback_later"

const OUTCOME_BUTTONS: { outcome: OutcomeType; label: string; icon: React.ReactNode; variant: "default" | "outline" | "destructive" | "secondary" }[] = [
  { outcome: "no_answer",      label: "No Answer",      icon: <PhoneOff className="w-4 h-4" />,       variant: "outline" },
  { outcome: "callback_later", label: "Call Back Later", icon: <Clock className="w-4 h-4" />,          variant: "outline" },
  { outcome: "not_interested", label: "Not Interested",  icon: <ThumbsDown className="w-4 h-4" />,    variant: "outline" },
  { outcome: "warm_lead",      label: "Warm Lead",       icon: <ThumbsUp className="w-4 h-4" />,      variant: "secondary" },
  { outcome: "approved",       label: "Approved",        icon: <CheckCircle2 className="w-4 h-4" />,  variant: "default" },
  { outcome: "wrong_number",   label: "Wrong Number",    icon: <AlertTriangle className="w-4 h-4" />, variant: "outline" },
  { outcome: "do_not_call",    label: "Do Not Call",     icon: <Ban className="w-4 h-4" />,           variant: "destructive" },
]

const STATUS_LABEL: Record<string, string> = {
  new:              "New",
  called_no_answer: "No Answer",
  not_interested:   "Not Interested",
  warm_lead:        "Warm Lead",
  approved:         "Approved",
  converted:        "Converted",
  do_not_call:      "DNC",
  wrong_number:     "Wrong #",
  callback_later:   "Call Back",
  no_callable_phone: "No Phone",
}

export function CallWorkspace({ open, onClose, lead, onOutcome }: Props) {
  const phones = lead.propstream_lead_phones.filter((p) => p.is_active && !p.is_wrong_number)

  const [selectedPhoneId, setSelectedPhoneId] = useState<string>(phones[0]?.id ?? "")
  const [callLogId, setCallLogId]             = useState<string | null>(null)
  const [calling,   setCalling]               = useState(false)
  const [callError, setCallError]             = useState<string | null>(null)
  const [outcome,   setOutcome]               = useState<OutcomeType | null>(null)
  const [notes,     setNotes]                 = useState("")
  const [saving,    setSaving]                = useState(false)
  const [smsOpen,   setSmsOpen]               = useState(false)

  const selectedPhone = phones.find((p) => p.id === selectedPhoneId) ?? phones[0]

  async function handleCall() {
    if (!selectedPhone) return
    setCalling(true)
    setCallError(null)
    const res = await fetch("/api/propstream/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id:  lead.id,
        phone_id: selectedPhone.id,
        to_phone: selectedPhone.phone,
      }),
    })
    const data = await res.json()
    setCalling(false)
    if (!res.ok) { setCallError(data.error ?? "Call failed"); return }
    setCallLogId(data.call_log_id)
  }

  async function handleOutcome(o: OutcomeType) {
    if (!selectedPhone) return
    setOutcome(o)
    setSaving(true)

    await fetch("/api/propstream/call/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call_log_id:       callLogId ?? "00000000-0000-0000-0000-000000000000",
        lead_id:           lead.id,
        phone_id:          selectedPhone.id,
        to_phone:          selectedPhone.phone,
        outcome:           o,
        notes:             notes.trim() || undefined,
        send_no_answer_sms: o === "no_answer",
      }),
    })

    setSaving(false)
    const statusMap: Record<OutcomeType, string> = {
      no_answer:      "called_no_answer",
      not_interested: "not_interested",
      warm_lead:      "warm_lead",
      approved:       "approved",
      do_not_call:    "do_not_call",
      wrong_number:   "called_no_answer",
      callback_later: "callback_later",
    }
    onOutcome(lead.id, statusMap[o])

    if (o !== "warm_lead" && o !== "approved") {
      handleClose()
    }
  }

  function handleClose() {
    setCallLogId(null)
    setCallError(null)
    setOutcome(null)
    setNotes("")
    setSaving(false)
    setCalling(false)
    onClose()
  }

  const formatPhone = (p: string) =>
    p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")

  const formatCurrency = (n: number | null) =>
    n == null ? "—" : `$${(n / 1000).toFixed(0)}k`

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneForwarded className="w-4 h-4 text-primary" />
              Call Workspace
            </DialogTitle>
          </DialogHeader>

          {/* Lead summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{lead.owner_name ?? "Unknown"}</span>
              <Badge variant="outline" className="text-xs">{STATUS_LABEL[lead.status] ?? lead.status}</Badge>
            </div>
            {lead.property_address && (
              <p className="text-muted-foreground text-xs">
                {lead.property_address}{lead.property_city ? `, ${lead.property_city}` : ""}{lead.property_state ? `, ${lead.property_state}` : ""}
              </p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground pt-0.5">
              <span>Est. Value: <span className="text-foreground">{formatCurrency(lead.estimated_value)}</span></span>
              <span>Equity: <span className="text-foreground">{formatCurrency(lead.estimated_equity)}</span></span>
            </div>
          </div>

          {/* Phone selector */}
          {phones.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Select phone to call</p>
              <div className="flex flex-wrap gap-2">
                {phones.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedPhoneId(p.id)}
                    className={[
                      "px-3 py-1.5 rounded-md border text-sm transition-colors",
                      p.id === selectedPhoneId
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border hover:bg-muted",
                    ].join(" ")}
                  >
                    {formatPhone(p.phone)}
                    {p.phone_type && <span className="ml-1.5 text-xs text-muted-foreground">({p.phone_type})</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {phones.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No callable phones available</p>
          )}

          {/* Call button */}
          {phones.length > 0 && !callLogId && (
            <div className="space-y-2">
              <Button
                className="w-full"
                size="lg"
                onClick={handleCall}
                disabled={calling || !selectedPhone}
              >
                <PhoneCall className="w-4 h-4 mr-2" />
                {calling ? "Dialing…" : `Call ${selectedPhone ? formatPhone(selectedPhone.phone) : ""}`}
              </Button>
              {callError && (
                <p className="text-xs text-destructive text-center">{callError}</p>
              )}
            </div>
          )}

          {/* Call in progress — outcome buttons */}
          {callLogId && !outcome && (
            <div className="space-y-3">
              <p className="text-xs text-center text-muted-foreground">
                <Phone className="w-3 h-3 inline mr-1" />
                Call initiated — select outcome
              </p>

              <div className="grid grid-cols-2 gap-2">
                {OUTCOME_BUTTONS.map((btn) => (
                  <Button
                    key={btn.outcome}
                    variant={btn.variant}
                    size="sm"
                    onClick={() => handleOutcome(btn.outcome)}
                    disabled={saving}
                    className="justify-start"
                  >
                    {btn.icon}
                    <span className="ml-1.5">{btn.label}</span>
                  </Button>
                ))}
              </div>

              <Textarea
                placeholder="Notes (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="resize-none text-sm"
              />
            </div>
          )}

          {/* Post-outcome actions for warm/approved */}
          {outcome && (outcome === "warm_lead" || outcome === "approved") && (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
              <p className="font-medium">Marked as {outcome === "warm_lead" ? "Warm Lead" : "Approved"}</p>
              <div className="flex gap-2 justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSmsOpen(true)}
                >
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  Send SMS
                </Button>
                <Button size="sm" onClick={handleClose}>Done</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedPhone && (
        <SmsModal
          open={smsOpen}
          onClose={() => setSmsOpen(false)}
          leadId={lead.id}
          phoneId={selectedPhone.id}
          toPhone={selectedPhone.phone}
          ownerName={lead.owner_name ?? "Lead"}
        />
      )}
    </>
  )
}
