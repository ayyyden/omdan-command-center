"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge }    from "@/components/ui/badge"
import {
  Phone, PhoneCall, PhoneOff, MessageSquare, ThumbsUp, ThumbsDown,
  AlertTriangle, Clock, Ban, CheckCircle2, PhoneForwarded, Loader2,
  Mic, MicOff, ArrowRight,
} from "lucide-react"
import { SmsModal } from "./sms-modal"
import type { Device as TwilioDevice, Call as TwilioCall } from "@twilio/voice-sdk"

// ─── Types ─────────────────────────────────────────────────────────────────────

interface LeadPhone {
  id:              string
  phone:           string
  phone_type:      string | null
  is_active:       boolean
  is_wrong_number: boolean
  position:        number
  is_completed:    boolean
}

// Matches the shape from /api/propstream/leads and /api/propstream/leads/[id]
interface Lead {
  id:               string
  owner_name:       string | null
  owner2_name?:     string | null
  property_address: string | null
  property_city:    string | null
  property_state:   string | null
  property_zip?:    string | null
  estimated_value:  number | null
  estimated_equity: number | null
  status:           string
  emails?:          string[]
  notes?:           string | null
  propstream_lead_phones: LeadPhone[]
}

interface Props {
  open:      boolean
  onClose:   () => void
  lead:      Lead
  onOutcome: (leadId: string, newStatus: string, leadDone?: boolean) => void
}

type OutcomeType =
  | "no_answer" | "not_interested" | "warm_lead" | "approved"
  | "do_not_call" | "wrong_number" | "callback_later"

type CallStatus = "idle" | "connecting" | "ringing" | "connected" | "error"

const OUTCOME_BUTTONS: {
  outcome: OutcomeType
  label: string
  icon: React.ReactNode
  variant: "default" | "outline" | "destructive" | "secondary"
}[] = [
  { outcome: "no_answer",      label: "No Answer",      icon: <PhoneOff className="w-4 h-4" />,       variant: "outline" },
  { outcome: "callback_later", label: "Call Back Later", icon: <Clock className="w-4 h-4" />,          variant: "outline" },
  { outcome: "not_interested", label: "Not Interested",  icon: <ThumbsDown className="w-4 h-4" />,    variant: "outline" },
  { outcome: "warm_lead",      label: "Warm Lead",       icon: <ThumbsUp className="w-4 h-4" />,      variant: "secondary" },
  { outcome: "approved",       label: "Approved",        icon: <CheckCircle2 className="w-4 h-4" />,  variant: "default" },
  { outcome: "wrong_number",   label: "Wrong Number",    icon: <AlertTriangle className="w-4 h-4" />, variant: "outline" },
  { outcome: "do_not_call",    label: "Do Not Call",     icon: <Ban className="w-4 h-4" />,           variant: "destructive" },
]

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtPhone(p: string) {
  return p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3")
}

function fmtCurrency(n: number | null) {
  return n == null ? "—" : `$${(n / 1000).toFixed(0)}k`
}

function normalizeToE164(raw: string): string {
  if (raw.startsWith("+")) return raw
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`
  return raw
}

function getWorkablePhones(lead: Lead): LeadPhone[] {
  return lead.propstream_lead_phones
    .filter((p) => p.is_active && !p.is_wrong_number)
    .sort((a, b) => a.position - b.position)
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function CallWorkspace({ open, onClose, lead, onOutcome }: Props) {
  const router = useRouter()

  // Local lead state — refreshed from API after each outcome when lead isn't done
  const [localLead,       setLocalLead]       = useState<Lead>(lead)
  const [refreshing,      setRefreshing]      = useState(false)

  const [selectedPhoneId, setSelectedPhoneId] = useState<string>(() => {
    const phones = getWorkablePhones(lead)
    return phones.find((p) => !p.is_completed)?.id ?? phones[0]?.id ?? ""
  })

  const [callLogId,   setCallLogId]   = useState<string | null>(null)
  const [callStatus,  setCallStatus]  = useState<CallStatus>("idle")
  const [isMuted,     setIsMuted]     = useState(false)
  const [callError,   setCallError]   = useState<string | null>(null)
  const [notes,       setNotes]       = useState("")
  const [saving,      setSaving]      = useState(false)
  const [outcomeMsg,  setOutcomeMsg]  = useState<string | null>(null)
  const [warmOutcome, setWarmOutcome] = useState<OutcomeType | null>(null)  // warm_lead post-outcome state
  const [smsOpen,     setSmsOpen]     = useState(false)

  const deviceRef = useRef<TwilioDevice | null>(null)
  const callRef   = useRef<TwilioCall | null>(null)

  // Reset all state when the dialog opens for a new lead
  useEffect(() => {
    if (open) {
      setLocalLead(lead)
      const phones = getWorkablePhones(lead)
      setSelectedPhoneId(phones.find((p) => !p.is_completed)?.id ?? phones[0]?.id ?? "")
      setCallLogId(null)
      setCallStatus("idle")
      setIsMuted(false)
      setCallError(null)
      setNotes("")
      setSaving(false)
      setOutcomeMsg(null)
      setWarmOutcome(null)
      if (callRef.current) { callRef.current.disconnect(); callRef.current = null }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead.id])

  const workablePhones = getWorkablePhones(localLead)
  const selectedPhone  = workablePhones.find((p) => p.id === selectedPhoneId) ?? workablePhones[0] ?? null
  const callActive     = callStatus === "ringing" || callStatus === "connected"
  const hasCallLog     = callLogId !== null

  // ── Device ───────────────────────────────────────────────────────────────────

  async function getDevice(): Promise<TwilioDevice> {
    if (deviceRef.current) return deviceRef.current
    const { Device } = await import("@twilio/voice-sdk")
    const res  = await fetch("/api/propstream/voice-token")
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? "Failed to get voice token")
    const device = new Device(data.token as string, { logLevel: "error" })
    deviceRef.current = device
    return device
  }

  // ── Call ─────────────────────────────────────────────────────────────────────

  async function handleCall(phone: LeadPhone) {
    if (callStatus !== "idle") return
    setSelectedPhoneId(phone.id)
    setCallLogId(null)
    setCallError(null)
    setOutcomeMsg(null)
    setCallStatus("connecting")

    // Create call log
    const logRes  = await fetch("/api/propstream/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: localLead.id, phone_id: phone.id, to_phone: phone.phone }),
    })
    const logData = await logRes.json()
    if (!logRes.ok) {
      setCallError(logData.error ?? "Call failed")
      setCallStatus("idle")
      return
    }
    setCallLogId(logData.call_log_id)

    // Connect via browser SDK
    try {
      const device   = await getDevice()
      const toNumber = normalizeToE164(phone.phone)
      const call     = await device.connect({ params: { To: toNumber } })
      callRef.current = call

      call.on("ringing",    () => setCallStatus("ringing"))
      call.on("accept",     () => setCallStatus("connected"))
      call.on("disconnect", () => { setCallStatus("idle"); setIsMuted(false); callRef.current = null })
      call.on("error",      (err: Error) => {
        setCallError(err.message ?? "Call error")
        setCallStatus("idle")
        callRef.current = null
      })
    } catch (err: unknown) {
      setCallError(err instanceof Error ? err.message : "Failed to connect call")
      setCallStatus("idle")
    }
  }

  function handleHangUp() { callRef.current?.disconnect() }

  function toggleMute() {
    if (!callRef.current) return
    const next = !isMuted
    callRef.current.mute(next)
    setIsMuted(next)
  }

  // ── Refresh lead ─────────────────────────────────────────────────────────────

  async function refreshLead() {
    setRefreshing(true)
    const res = await fetch(`/api/propstream/leads/${localLead.id}`)
    if (res.ok) {
      const data = await res.json()
      setLocalLead(data as Lead)
    }
    setRefreshing(false)
  }

  // ── Outcome ───────────────────────────────────────────────────────────────────

  async function handleOutcome(o: OutcomeType) {
    if (!selectedPhone || saving) return

    // Hang up active call before recording outcome
    if (callRef.current) { callRef.current.disconnect(); callRef.current = null }

    setSaving(true)
    setOutcomeMsg(null)

    const res  = await fetch("/api/propstream/call/outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id:             localLead.id,
        phone_id:            selectedPhone.id,
        to_phone:            selectedPhone.phone,
        outcome:             o,
        call_log_id:         callLogId ?? undefined,
        notes:               notes.trim() || undefined,
        send_no_answer_sms:  true,
      }),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setCallError(data.error ?? "Failed to save outcome")
      return
    }

    const { lead_done, lead_status, next_phone_id, sms_sent, sms_error } = data as {
      lead_done:     boolean
      lead_status:   string | null
      next_phone_id: string | null
      sms_sent:      boolean
      sms_error:     string | null
    }

    // Notify parent of the status change
    onOutcome(localLead.id, lead_status ?? o, lead_done)

    // ── approved: navigate to new customer page ──────────────────────────────
    if (o === "approved") {
      const address = [
        localLead.property_address,
        localLead.property_city,
        localLead.property_state,
        localLead.property_zip,
      ].filter(Boolean).join(", ")

      const params = new URLSearchParams({
        from_propstream: localLead.id,
        phone_id:        selectedPhone.id,
        phone:           selectedPhone.phone,
        name:            localLead.owner_name ?? "",
        email:           localLead.emails?.[0] ?? "",
        address,
        notes:           (notes || localLead.notes || "").substring(0, 600),
        return_to:       "/propstream-leads",
      })
      handleClose()
      router.push(`/customers/new?${params}`)
      return
    }

    // ── warm_lead: show confirmation panel (keep open for SMS) ──────────────
    if (o === "warm_lead") {
      setWarmOutcome("warm_lead")
      return
    }

    // ── lead_done: close workspace ───────────────────────────────────────────
    if (lead_done) {
      handleClose()
      return
    }

    // ── lead not done: stay open, select next phone ──────────────────────────
    const msg = buildOutcomeMsg(o, sms_sent, sms_error)
    setOutcomeMsg(msg)
    setCallLogId(null)
    setCallStatus("idle")
    setIsMuted(false)

    // Refresh lead to get updated is_completed flags, then select next phone
    await refreshLead()
    if (next_phone_id) setSelectedPhoneId(next_phone_id)
  }

  function buildOutcomeMsg(o: OutcomeType, sms_sent: boolean, sms_error: string | null): string {
    if (o === "no_answer") {
      if (sms_sent) return "No answer — auto-SMS sent. Moving to next phone."
      if (sms_error) return `No answer — SMS failed: ${sms_error}. Moving to next phone.`
      return "No answer saved. Moving to next phone."
    }
    if (o === "not_interested") return "Not interested. Moving to next phone."
    if (o === "callback_later") return "Saved — call back later. Moving to next phone."
    if (o === "wrong_number")   return "Wrong number marked. Moving to next phone."
    return "Saved."
  }

  // ── Close ─────────────────────────────────────────────────────────────────────

  function handleClose() {
    if (callRef.current) { callRef.current.disconnect(); callRef.current = null }
    setCallLogId(null)
    setCallError(null)
    setCallStatus("idle")
    setIsMuted(false)
    setOutcomeMsg(null)
    setWarmOutcome(null)
    setNotes("")
    setSaving(false)
    onClose()
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PhoneForwarded className="w-4 h-4 text-primary" />
              Call Workspace
            </DialogTitle>
          </DialogHeader>

          {/* Lead summary */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{localLead.owner_name ?? "Unknown"}</span>
              <Badge variant="outline" className="text-xs">{localLead.status.replace(/_/g, " ")}</Badge>
            </div>
            {localLead.property_address && (
              <p className="text-muted-foreground text-xs">
                {localLead.property_address}
                {localLead.property_city ? `, ${localLead.property_city}` : ""}
                {localLead.property_state ? `, ${localLead.property_state}` : ""}
              </p>
            )}
            <div className="flex gap-4 text-xs text-muted-foreground pt-0.5">
              <span>Value: <span className="text-foreground">{fmtCurrency(localLead.estimated_value)}</span></span>
              <span>Equity: <span className="text-foreground">{fmtCurrency(localLead.estimated_equity)}</span></span>
            </div>
          </div>

          {/* Outcome confirmation after warm_lead */}
          {warmOutcome === "warm_lead" && (
            <div className="space-y-3 text-center py-2">
              <CheckCircle2 className="w-8 h-8 text-green-500 mx-auto" />
              <p className="font-medium">Marked as Warm Lead</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={() => setSmsOpen(true)}>
                  <MessageSquare className="w-4 h-4 mr-1.5" />
                  Send SMS
                </Button>
                <Button size="sm" onClick={handleClose}>Done</Button>
              </div>
            </div>
          )}

          {/* Main calling interface — hidden after warm_lead outcome */}
          {!warmOutcome && (
            <>
              {/* Outcome feedback message */}
              {outcomeMsg && (
                <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 text-xs px-3 py-2 flex items-center gap-2">
                  <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                  {outcomeMsg}
                </div>
              )}

              {/* Phone list */}
              {workablePhones.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-2">No callable phones available</p>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground">
                    {refreshing ? "Refreshing…" : "Select phone to call"}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {workablePhones.map((p) => {
                      const isSelected   = p.id === selectedPhoneId
                      const isCompleted  = p.is_completed
                      const isCallingNow = isSelected && callActive

                      return (
                        <div
                          key={p.id}
                          className={[
                            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors",
                            isCompleted
                              ? "border-border opacity-50 bg-muted/20"
                              : isSelected
                                ? "border-primary bg-primary/5"
                                : "border-border hover:border-primary/50 cursor-pointer",
                          ].join(" ")}
                          onClick={() => !isCompleted && callStatus === "idle" && setSelectedPhoneId(p.id)}
                        >
                          <div>
                            <p className={`text-sm font-medium ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                              {fmtPhone(p.phone)}
                            </p>
                            {p.phone_type && (
                              <p className="text-xs text-muted-foreground">{p.phone_type}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {isCompleted && (
                              <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                            )}
                            {!isCompleted && (
                              <Button
                                size="sm"
                                variant={isCallingNow ? "secondary" : "outline"}
                                className="h-7 gap-1 text-xs"
                                disabled={callStatus !== "idle"}
                                onClick={(e) => { e.stopPropagation(); handleCall(p) }}
                              >
                                {isSelected && callStatus === "connecting" ? (
                                  <><Loader2 className="w-3 h-3 animate-spin" />Connecting…</>
                                ) : isCallingNow ? (
                                  <><Phone className="w-3 h-3 text-green-600" />
                                  {callStatus === "ringing" ? "Ringing…" : "On Call"}
                                  </>
                                ) : (
                                  <><PhoneCall className="w-3 h-3" />Call</>
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Call error */}
              {callError && (
                <p className="text-xs text-destructive text-center">{callError}</p>
              )}

              {/* Active call controls */}
              {callActive && (
                <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-900/20 px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <Phone className="w-3.5 h-3.5 animate-pulse" />
                    {callStatus === "ringing" ? "Ringing…" : "Connected"}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={toggleMute}
                      disabled={callStatus !== "connected"}
                    >
                      {isMuted ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                      {isMuted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 gap-1 text-xs"
                      onClick={handleHangUp}
                    >
                      <PhoneOff className="w-3 h-3" />
                      Hang Up
                    </Button>
                  </div>
                </div>
              )}

              {/* Outcome buttons — visible once a call log exists */}
              {hasCallLog && !saving && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {callActive ? "Select outcome (or hang up first):" : "Select outcome:"}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {OUTCOME_BUTTONS.map((btn) => (
                      <Button
                        key={btn.outcome}
                        variant={btn.variant}
                        size="sm"
                        onClick={() => handleOutcome(btn.outcome)}
                        disabled={saving}
                        className="justify-start text-xs"
                      >
                        {btn.icon}
                        <span className="ml-1.5">{btn.label}</span>
                      </Button>
                    ))}
                  </div>

                  <Textarea
                    placeholder="Notes (saved with outcome)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="resize-none text-sm"
                  />
                </div>
              )}

              {saving && (
                <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving…
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      {selectedPhone && (
        <SmsModal
          open={smsOpen}
          onClose={() => setSmsOpen(false)}
          leadId={localLead.id}
          phoneId={selectedPhone.id}
          toPhone={selectedPhone.phone}
          ownerName={localLead.owner_name ?? "Lead"}
        />
      )}
    </>
  )
}
