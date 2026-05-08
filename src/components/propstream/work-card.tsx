"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  ChevronLeft, ChevronRight, Phone, PhoneCall, PhoneOff,
  ThumbsDown, Star, CheckCircle2, ArrowLeft, Loader2,
  AlertCircle, RefreshCw, Home,
} from "lucide-react"

// ─── Types ─────────────────────────────────────────────────────────────────────

interface WorkLead { id: string; owner_name: string | null; status: string }

interface LeadPhone {
  id:             string
  phone:          string
  phone_type:     string | null
  is_active:      boolean
  is_wrong_number: boolean
  position:       number
  is_completed:   boolean
  attempt_count:  number
  last_outcome:   string | null
  last_called_at: string | null
}

interface FullLead {
  id:               string
  owner_name:       string | null
  owner2_name:      string | null
  property_address: string | null
  property_city:    string | null
  property_state:   string | null
  property_zip:     string | null
  property_type:    string | null
  bedrooms:         number | null
  bathrooms:        number | null
  sqft:             number | null
  estimated_value:  number | null
  estimated_equity: number | null
  emails:           string[]
  notes:            string | null
  status:           string
  propstream_lead_phones: LeadPhone[]
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null, prefix = "$", suffix = ""): string {
  if (n == null) return "—"
  if (prefix === "$") return `$${(n / 1000).toFixed(0)}k`
  return `${n}${suffix}`
}

function fmtPhone(e164: string): string {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164
}

const STATUS_LABEL: Record<string, string> = {
  new:              "New",
  called_no_answer: "No Answer",
  callback_later:   "Call Back",
  not_interested:   "Not Interested",
  warm_lead:        "Warm Lead",
  need_follow_up:   "Follow-Up",
  approved:         "Approved",
  converted:        "Converted",
  do_not_call:      "DNC",
}

const STATUS_COLOR: Record<string, string> = {
  new:              "bg-blue-100 text-blue-800",
  called_no_answer: "bg-orange-100 text-orange-800",
  callback_later:   "bg-yellow-100 text-yellow-800",
  not_interested:   "bg-gray-100 text-gray-600",
  warm_lead:        "bg-green-100 text-green-700",
  need_follow_up:   "bg-purple-100 text-purple-800",
  approved:         "bg-emerald-100 text-emerald-800",
  converted:        "bg-teal-100 text-teal-800",
}

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props { listId?: string }

export function WorkCard({ listId }: Props) {
  const router = useRouter()

  // Queue state
  const [queue,        setQueue]        = useState<WorkLead[]>([])
  const [index,        setIndex]        = useState(0)
  const [queueLoading, setQueueLoading] = useState(true)
  const [queueError,   setQueueError]   = useState<string | null>(null)

  // Current lead
  const [lead,        setLead]        = useState<FullLead | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)

  // Call / interaction state
  const [selectedPhoneId, setSelectedPhoneId] = useState<string | null>(null)
  const [callLogId,       setCallLogId]       = useState<string | null>(null)
  const [calling,         setCalling]         = useState(false)
  const [callError,       setCallError]       = useState<string | null>(null)
  const [notes,           setNotes]           = useState("")
  const [busy,            setBusy]            = useState(false)
  const [outcomeMsg,      setOutcomeMsg]      = useState<string | null>(null)
  const [outcomeError,    setOutcomeError]    = useState<string | null>(null)

  // Track history for left-arrow navigation
  const historyRef = useRef<string[]>([])

  // ── Queue fetch ────────────────────────────────────────────────────────────

  const fetchQueue = useCallback(async () => {
    setQueueLoading(true)
    setQueueError(null)
    const params = new URLSearchParams()
    if (listId) params.set("list_id", listId)
    const res  = await fetch(`/api/propstream/work/queue?${params}`)
    const data = await res.json()
    setQueueLoading(false)
    if (!res.ok) { setQueueError(data.error ?? "Failed to load queue"); return }
    setQueue(data.queue ?? [])
    setIndex(0)
  }, [listId])

  useEffect(() => { fetchQueue() }, [fetchQueue])

  // ── Lead fetch ─────────────────────────────────────────────────────────────

  const fetchLead = useCallback(async (leadId: string) => {
    setLeadLoading(true)
    setCallLogId(null)
    setCallError(null)
    setOutcomeMsg(null)
    setOutcomeError(null)
    setNotes("")
    const res  = await fetch(`/api/propstream/leads/${leadId}`)
    const data = await res.json()
    setLeadLoading(false)
    if (!res.ok) return
    setLead(data as FullLead)
    // Auto-select the first uncompleted phone
    const first = (data as FullLead).propstream_lead_phones
      .filter((p: LeadPhone) => p.is_active && !p.is_wrong_number && !p.is_completed)
      .sort((a: LeadPhone, b: LeadPhone) => a.position - b.position)[0]
    setSelectedPhoneId(first?.id ?? null)
  }, [])

  useEffect(() => {
    const current = queue[index]
    if (!current) return
    fetchLead(current.id)
  }, [queue, index, fetchLead])

  // ── Navigation ─────────────────────────────────────────────────────────────

  function goNext() {
    if (lead) historyRef.current.push(lead.id)
    setIndex((i) => Math.min(i + 1, queue.length))  // go past end → "done" state
  }

  function goPrev() {
    if (index > 0) setIndex((i) => i - 1)
  }

  // ── Call ───────────────────────────────────────────────────────────────────

  async function handleCall(phone: LeadPhone) {
    if (!lead || calling) return
    setSelectedPhoneId(phone.id)
    setCallLogId(null)
    setCalling(true)
    setCallError(null)
    const res  = await fetch("/api/propstream/call", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: lead.id, phone_id: phone.id, to_phone: phone.phone }),
    })
    const data = await res.json()
    setCalling(false)
    if (!res.ok) { setCallError(data.error ?? "Call failed"); return }
    setCallLogId(data.call_log_id)
  }

  // ── Outcome ────────────────────────────────────────────────────────────────

  async function handleOutcome(outcome: "no_answer" | "not_interested" | "need_follow_up" | "approved") {
    if (!lead || !selectedPhoneId || busy) return

    // Approved → navigate to customer creation with prefilled data
    if (outcome === "approved") {
      setBusy(true)
      await fetch("/api/propstream/work/phone-outcome", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id, phone_id: selectedPhoneId, outcome: "approved", call_log_id: callLogId, notes }),
      })
      setBusy(false)

      const selectedPhone = lead.propstream_lead_phones.find((p) => p.id === selectedPhoneId)
      const address = [lead.property_address, lead.property_city, lead.property_state, lead.property_zip]
        .filter(Boolean).join(", ")

      const params = new URLSearchParams({
        from_propstream: lead.id,
        phone_id:        selectedPhoneId,
        phone:           selectedPhone?.phone ?? "",
        name:            lead.owner_name ?? "",
        email:           lead.emails[0] ?? "",
        address,
        notes:           (notes || lead.notes || "").substring(0, 600),
        return_to:       `/propstream-leads/work${listId ? `?list_id=${listId}` : ""}`,
      })
      router.push(`/customers/new?${params}`)
      return
    }

    setBusy(true)
    setOutcomeMsg(null)
    setOutcomeError(null)

    const res  = await fetch("/api/propstream/work/phone-outcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id:      lead.id,
        phone_id:     selectedPhoneId,
        outcome,
        call_log_id:  callLogId ?? undefined,
        notes,
      }),
    })
    const data = await res.json()
    setBusy(false)

    if (!res.ok) {
      setOutcomeError(data.error ?? "Failed to save outcome")
      return
    }

    const messages: Record<string, string> = {
      no_answer:      data.sms_sent ? "No answer saved — SMS sent" : "No answer saved" + (data.sms_error ? ` (SMS failed: ${data.sms_error})` : ""),
      not_interested: "Marked not interested",
      need_follow_up: "Saved as follow-up",
    }
    setOutcomeMsg(messages[outcome] ?? "Saved")

    if (data.lead_done) {
      // All phones handled — remove from queue and advance
      setQueue((prev) => prev.filter((_, i) => i !== index))
      // index stays, next item slides into position
    } else {
      // More phones left on this lead — refresh and auto-select next uncompleted
      await fetchLead(lead.id)
    }
  }

  // ─── Render states ────────────────────────────────────────────────────────

  if (queueLoading) return <PageShell><CenteredMsg icon={<Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />} title="Loading work queue…" /></PageShell>
  if (queueError)   return <PageShell><CenteredMsg icon={<AlertCircle className="w-8 h-8 text-destructive" />} title="Failed to load queue" sub={queueError}><Button onClick={fetchQueue} variant="outline" size="sm"><RefreshCw className="w-4 h-4 mr-2" />Retry</Button></CenteredMsg></PageShell>

  if (queue.length === 0) return (
    <PageShell>
      <CenteredMsg icon={<CheckCircle2 className="w-12 h-12 text-green-500" />} title="All caught up!" sub="No eligible leads remain in the work queue.">
        <Button onClick={() => router.push("/propstream-leads")} variant="outline">
          <Home className="w-4 h-4 mr-2" />Back to Lead Center
        </Button>
        <Button onClick={fetchQueue} variant="ghost" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
      </CenteredMsg>
    </PageShell>
  )

  if (index >= queue.length) return (
    <PageShell>
      <CenteredMsg icon={<CheckCircle2 className="w-12 h-12 text-green-500" />} title="Session complete!" sub={`You worked through all ${queue.length} lead${queue.length !== 1 ? "s" : ""} in this session.`}>
        <Button onClick={() => router.push("/propstream-leads")} variant="outline">
          <Home className="w-4 h-4 mr-2" />Back to Lead Center
        </Button>
        <Button onClick={fetchQueue} variant="ghost" size="sm"><RefreshCw className="w-4 h-4 mr-1" />Reload Queue</Button>
      </CenteredMsg>
    </PageShell>
  )

  const workablePhones = (lead?.propstream_lead_phones ?? [])
    .filter((p) => p.is_active && !p.is_wrong_number)
    .sort((a, b) => a.position - b.position)

  const selectedPhone = workablePhones.find((p) => p.id === selectedPhoneId)
  const canOutcome    = !!selectedPhoneId && !busy

  return (
    <PageShell>
      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/propstream-leads")} className="text-muted-foreground">
          <ArrowLeft className="w-4 h-4 mr-1" />
          Lead Center
        </Button>
        <span className="text-sm text-muted-foreground font-medium">
          Lead {index + 1} of {queue.length}
          {queue.length > 0 && <span className="ml-1 text-xs">({queue.length - index - 1} remaining)</span>}
        </span>
        <Button variant="ghost" size="sm" onClick={fetchQueue} disabled={queueLoading} className="text-muted-foreground">
          <RefreshCw className={`w-4 h-4 ${queueLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ── Main card ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-stretch justify-start px-3 sm:px-6 pb-6">
        <div className="w-full max-w-4xl mx-auto">

          {/* Navigation row */}
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={goPrev}
              disabled={index === 0}
              className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              aria-label="Previous lead"
            >
              <ChevronLeft className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>

            <div className="flex-1 text-center">
              {leadLoading ? (
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
              ) : (
                <>
                  <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold tracking-tight leading-tight">
                    {lead?.owner_name ?? "—"}
                  </h1>
                  {lead?.owner2_name && (
                    <p className="text-sm text-muted-foreground mt-0.5">&amp; {lead.owner2_name}</p>
                  )}
                  <div className="flex items-center justify-center gap-2 mt-1.5">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[lead?.status ?? ""] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[lead?.status ?? ""] ?? lead?.status}
                    </span>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={goNext}
              className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 border-border flex items-center justify-center text-muted-foreground hover:border-primary hover:text-primary transition-all"
              aria-label="Next lead"
            >
              <ChevronRight className="w-6 h-6 sm:w-7 sm:h-7" />
            </button>
          </div>

          {/* Card body */}
          {!leadLoading && lead && (
            <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">

              {/* Address bar */}
              <div className="px-5 py-3 border-b bg-muted/30 text-center">
                <p className="text-base sm:text-lg font-medium">
                  {[lead.property_address, lead.property_city, lead.property_state, lead.property_zip].filter(Boolean).join(", ") || "No address on file"}
                </p>
              </div>

              {/* Two-column body */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x">

                {/* Left: property info */}
                <div className="p-5 space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Property Info</h2>
                  <dl className="space-y-2">
                    {lead.property_type && <InfoRow label="Type" value={lead.property_type} />}
                    {(lead.bedrooms != null || lead.bathrooms != null) && (
                      <InfoRow label="Beds / Baths" value={`${lead.bedrooms ?? "—"} bd / ${lead.bathrooms ?? "—"} ba`} />
                    )}
                    {lead.sqft != null && <InfoRow label="SqFt" value={`${lead.sqft.toLocaleString()} sqft`} />}
                    <InfoRow label="Est. Value"  value={fmt(lead.estimated_value)} highlight />
                    <InfoRow label="Est. Equity" value={fmt(lead.estimated_equity)} highlight />
                    {lead.emails[0] && <InfoRow label="Email" value={lead.emails[0]} />}
                    {lead.notes && (
                      <div className="pt-1">
                        <dt className="text-xs text-muted-foreground">Notes</dt>
                        <dd className="text-sm mt-0.5 text-foreground/80 whitespace-pre-wrap">{lead.notes}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {/* Right: phones */}
                <div className="p-5 space-y-3">
                  <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Phone Numbers</h2>

                  {workablePhones.length === 0 && (
                    <p className="text-sm text-muted-foreground">No callable phones on this lead.</p>
                  )}

                  <div className="space-y-2">
                    {workablePhones.map((phone) => {
                      const isSelected  = phone.id === selectedPhoneId
                      const isCompleted = phone.is_completed

                      return (
                        <div
                          key={phone.id}
                          onClick={() => !isCompleted && setSelectedPhoneId(phone.id)}
                          className={[
                            "rounded-xl border-2 p-3 transition-all",
                            isCompleted
                              ? "opacity-50 bg-muted/30 border-border cursor-default"
                              : isSelected
                                ? "border-primary bg-primary/5 cursor-pointer"
                                : "border-border hover:border-primary/50 cursor-pointer",
                          ].join(" ")}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className={`text-base sm:text-lg font-semibold ${isCompleted ? "line-through text-muted-foreground" : ""}`}>
                                {fmtPhone(phone.phone)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {phone.phone_type ?? "Unknown type"}
                                {phone.attempt_count > 0 && ` · ${phone.attempt_count} attempt${phone.attempt_count !== 1 ? "s" : ""}`}
                                {phone.last_outcome && ` · ${phone.last_outcome.replace(/_/g, " ")}`}
                              </p>
                            </div>

                            {!isCompleted && (
                              <Button
                                size="sm"
                                variant={isSelected && callLogId ? "secondary" : "outline"}
                                onClick={(e) => { e.stopPropagation(); handleCall(phone) }}
                                disabled={calling}
                                className="shrink-0 gap-1.5"
                              >
                                {calling && selectedPhoneId === phone.id ? (
                                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />Calling…</>
                                ) : callLogId && isSelected ? (
                                  <><Phone className="w-3.5 h-3.5 text-green-600" />On Call</>
                                ) : (
                                  <><PhoneCall className="w-3.5 h-3.5" />Call</>
                                )}
                              </Button>
                            )}

                            {isCompleted && (
                              <CheckCircle2 className="w-5 h-5 text-muted-foreground shrink-0" />
                            )}
                          </div>

                          {isSelected && callError && (
                            <p className="text-xs text-destructive mt-1.5">{callError}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>

                  {selectedPhone && !selectedPhone.is_completed && (
                    <p className="text-xs text-muted-foreground pt-1">
                      Outcome will apply to: <strong>{fmtPhone(selectedPhone.phone)}</strong>
                    </p>
                  )}
                </div>
              </div>

              {/* Notes row */}
              <div className="px-5 py-4 border-t bg-muted/20">
                <Textarea
                  placeholder="Session notes (saved with outcome)…"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="resize-none text-sm bg-background"
                />
              </div>

              {/* Outcome status messages */}
              {(outcomeMsg || outcomeError) && (
                <div className={`px-5 py-2.5 text-sm font-medium text-center ${outcomeError ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"}`}>
                  {outcomeError ?? outcomeMsg}
                </div>
              )}

              {/* Outcome buttons */}
              <div className="p-4 border-t grid grid-cols-2 lg:grid-cols-4 gap-3">
                <OutcomeBtn
                  label="No Answer"
                  sublabel="Send auto-SMS"
                  icon={<PhoneOff className="w-5 h-5" />}
                  color="border-orange-300 hover:bg-orange-50 hover:border-orange-400 dark:hover:bg-orange-900/20"
                  disabled={!canOutcome}
                  busy={busy}
                  onClick={() => handleOutcome("no_answer")}
                />
                <OutcomeBtn
                  label="Not Interested"
                  sublabel="Move to next phone"
                  icon={<ThumbsDown className="w-5 h-5" />}
                  color="border-gray-300 hover:bg-gray-50 hover:border-gray-400 dark:hover:bg-gray-800/40"
                  disabled={!canOutcome}
                  busy={busy}
                  onClick={() => handleOutcome("not_interested")}
                />
                <OutcomeBtn
                  label="Need Follow-Up"
                  sublabel="Save &amp; move on"
                  icon={<Star className="w-5 h-5" />}
                  color="border-purple-300 hover:bg-purple-50 hover:border-purple-400 dark:hover:bg-purple-900/20 text-purple-700 dark:text-purple-300"
                  disabled={!canOutcome}
                  busy={busy}
                  onClick={() => handleOutcome("need_follow_up")}
                />
                <OutcomeBtn
                  label="Approved"
                  sublabel="Create CRM lead"
                  icon={<CheckCircle2 className="w-5 h-5" />}
                  color="border-emerald-400 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400"
                  disabled={!canOutcome}
                  busy={busy}
                  onClick={() => handleOutcome("approved")}
                  prominent
                />
              </div>
            </div>
          )}

          {/* Skip / manual nav */}
          <div className="flex justify-center mt-4 gap-3">
            <Button variant="ghost" size="sm" onClick={goNext} className="text-muted-foreground text-xs">
              Skip this lead →
            </Button>
          </div>

        </div>
      </div>
    </PageShell>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen">
      {children}
    </div>
  )
}

function CenteredMsg({
  icon, title, sub, children,
}: {
  icon: React.ReactNode; title: string; sub?: string; children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-4 p-8 text-center min-h-[60vh]">
      {icon}
      <h2 className="text-xl font-semibold">{title}</h2>
      {sub && <p className="text-muted-foreground max-w-xs text-sm">{sub}</p>}
      {children && <div className="flex gap-2 flex-wrap justify-center">{children}</div>}
    </div>
  )
}

function InfoRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-sm text-muted-foreground shrink-0">{label}</dt>
      <dd className={`text-sm font-medium text-right ${highlight ? "text-primary" : ""}`}>{value}</dd>
    </div>
  )
}

function OutcomeBtn({
  label, sublabel, icon, color, disabled, busy, onClick, prominent,
}: {
  label: string; sublabel: string; icon: React.ReactNode
  color: string; disabled: boolean; busy: boolean
  onClick: () => void; prominent?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      className={[
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-4 sm:py-5",
        "text-center transition-all select-none",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        prominent ? "font-semibold shadow-sm" : "font-medium",
        color,
      ].join(" ")}
    >
      {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : icon}
      <span className="text-sm sm:text-base leading-tight">{label}</span>
      <span className="text-xs text-muted-foreground font-normal hidden sm:block" dangerouslySetInnerHTML={{ __html: sublabel }} />
    </button>
  )
}
