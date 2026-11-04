"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { Loader2, Send, AlertCircle, Sparkles, CheckCircle2, UserRound, Save, Wand2, RotateCcw } from "lucide-react"
import { upsertEstimateFollowUp } from "@/lib/reminders"
import { serializeScope, parseScope, parseNotes, formatMoney, defaultEstimateEmail, ESTIMATE_VALID_DAYS } from "@/lib/estimate-format"
import type { Customer, Estimate } from "@/types"

interface Template { id: string; name: string; type: string; subject: string | null; body: string }

interface CompanySettings {
  company_name: string | null
  phone: string | null
  email: string | null
  license_number: string | null
  logo_url: string | null
  address: string | null
  google_review_link: string | null
  default_estimate_notes?: string | null
}

interface EstimateFormProps {
  estimate?: Estimate
  customers: Customer[]
  userId: string
  preselectedCustomerId?: string
  defaultNotes?: string
  templates?: Template[]
  companySettings?: CompanySettings | null
}

/** What the AI writes — everything on the estimate besides the lead's details. */
interface Written {
  title: string
  total: number | null
  sections: { heading: string; bullets: string[] }[]
  payment_steps: { name: string; description: string; amount: number }[]
  notes: string[]
}

function renderTemplate(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`)
}

// The estimate page is two things: pick the lead, describe the job in a few
// words. The CRM writes the whole estimate (title, detailed numbered scope,
// payment schedule, notes), shows it as it will look, and takes changes in
// plain words. It won't save without a payment schedule that adds up.
export function EstimateForm({ estimate, customers, userId, preselectedCustomerId, templates = [], companySettings }: EstimateFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const est = estimate as (Estimate & { brief?: string | null; payment_steps?: { name: string; amount: number; description?: string | null }[] }) | undefined

  // ── What the AI wrote (or what's saved, when editing) ─────────────────────
  const [written, setWritten] = useState<Written | null>(() => {
    if (!est) return null
    const scope = parseScope(est.scope_of_work)
    if (!scope.sections.length) return null   // an old free-text scope → write it again
    return {
      title: est.title,
      total: Number(est.total) || null,
      sections: scope.sections,
      payment_steps: (est.payment_steps ?? []).map((p) => ({ name: p.name, amount: Number(p.amount), description: p.description ?? "" })),
      notes: parseNotes(est.notes),
    }
  })
  const [brief, setBrief] = useState<string>(() => {
    if (est?.brief) return est.brief
    // Older estimates where the note was typed straight into the scope box
    if (est?.scope_of_work && !parseScope(est.scope_of_work).sections.length) return est.scope_of_work
    return ""
  })
  const [change, setChange] = useState("")
  const [writing, setWriting] = useState<"write" | "change" | null>(null)

  // ── The lead ("Prepared for") ─────────────────────────────────────────────
  const [customerList, setCustomerList] = useState<Customer[]>(customers)
  const [customerId, setCustomerId] = useState<string>(est?.customer_id ?? preselectedCustomerId ?? "")
  const [pf, setPf] = useState({ name: "", phone: "", email: "", address: "" })
  const [pfFor, setPfFor] = useState<string | null>(null)
  const [pfDirty, setPfDirty] = useState(false)
  const [savingPf, setSavingPf] = useState(false)
  if (customerId && pfFor !== customerId) {
    const c = customerList.find((x) => x.id === customerId)
    if (c) {
      setPfFor(customerId)
      setPf({ name: c.name ?? "", phone: c.phone ?? "", email: c.email ?? "", address: c.address ?? "" })
      setPfDirty(false)
    }
  }

  // ── Save / send ───────────────────────────────────────────────────────────
  const [saving, setSaving] = useState<"save" | "send" | null>(null)
  const [sendOpen, setSendOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(est?.id ?? null)
  const [to, setTo] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [tplId, setTplId] = useState("")
  const followUpTemplates = templates.filter((t) => t.type === "estimate_follow_up")

  const steps = written?.payment_steps ?? []
  const paymentsSum = steps.reduce((t, p) => t + Math.round(p.amount * 100), 0) / 100
  const noTotal = !!written && !written.total
  const noPayments = !!written && steps.length === 0
  const paymentsOff = !!written?.total && steps.length > 0 && Math.round(paymentsSum * 100) !== Math.round(written.total * 100)
  const problem = !written ? null
    : noTotal ? "There's no total price. Add it to your description (e.g. “total 48777”) and write it again."
    : noPayments ? "There's no payment schedule. Add the payments to your description (e.g. “5 payments: 10000 demo, 20000 material arrival…”) or ask for them below."
    : paymentsOff ? `The payments add up to ${formatMoney(paymentsSum)}, not ${formatMoney(written.total ?? 0)}. Ask for a change below.`
    : null

  async function savePreparedFor(): Promise<boolean> {
    if (!customerId) return false
    if (!pf.name.trim()) { toast({ title: "The lead needs a name", variant: "destructive" }); return false }
    setSavingPf(true)
    const patch = { name: pf.name.trim(), phone: pf.phone.trim() || null, email: pf.email.trim() || null, address: pf.address.trim() || null }
    const { error } = await createClient().from("customers").update(patch).eq("id", customerId)
    setSavingPf(false)
    if (error) { toast({ title: "Couldn't update the lead card", description: error.message, variant: "destructive" }); return false }
    setCustomerList((list) => list.map((c) => (c.id === customerId ? ({ ...c, ...patch } as Customer) : c)))
    setPfDirty(false)
    toast({ title: "Lead card updated", description: patch.name })
    return true
  }

  async function runAI(mode: "write" | "change") {
    if (brief.trim().length < 8) { toast({ title: "Describe the job first", variant: "destructive" }); return }
    if (mode === "change" && !change.trim()) return
    setWriting(mode)
    try {
      const res = await fetch("/api/estimates/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "change" ? { brief, change, current: written } : { brief }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Couldn't write the estimate")
      setWritten({ title: data.title, total: data.total, sections: data.sections, payment_steps: data.payment_steps ?? [], notes: data.notes ?? [] })
      if (mode === "change") setChange("")
    } catch (err) {
      toast({ title: "Couldn't write the estimate", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
    } finally {
      setWriting(null)
    }
  }

  async function saveEstimate(): Promise<string | null> {
    if (!customerId) { toast({ title: "Pick the lead card first", variant: "destructive" }); return null }
    if (!written) { toast({ title: "Press “Write the estimate” first", variant: "destructive" }); return null }
    if (problem) { toast({ title: "Not ready yet", description: problem, variant: "destructive" }); return null }
    if (pfDirty && !(await savePreparedFor())) return null

    const supabase = createClient()
    const total = written.total!
    const payload: Record<string, unknown> = {
      customer_id:        customerId,
      title:              written.title,
      scope_of_work:      serializeScope(written.sections),
      manual_total_price: total,
      subtotal:           total,
      markup_percent:     0,
      markup_amount:      0,
      tax_percent:        0,
      tax_amount:         0,
      total,
      line_items:         [],
      notes:              written.notes.join("\n"),
      brief:              brief.trim() || null,
      user_id:            userId,
      ...(est ? {} : { status: "draft" }),
    }
    let id = est?.id ?? null
    const write = async (row: Record<string, unknown>) => {
      if (est) return (await supabase.from("estimates").update(row).eq("id", est.id)).error
      const { data, error } = await supabase.from("estimates").insert(row).select("id").single()
      id = data?.id ?? null
      return error
    }
    let error = await write(payload)
    if (error && /brief/.test(error.message)) { delete payload.brief; error = await write(payload) }
    if (error || !id) { toast({ title: "Couldn't save the estimate", description: error?.message, variant: "destructive" }); return null }

    await supabase.from("estimate_payment_steps").delete().eq("estimate_id", id)
    const { error: stepsErr } = await supabase.from("estimate_payment_steps").insert(
      steps.map((p, i) => ({ estimate_id: id, name: p.name, amount: p.amount, description: p.description || null, sort_order: i })),
    )
    if (stepsErr) { toast({ title: "Couldn't save the payment schedule", description: stepsErr.message, variant: "destructive" }); return null }
    setSavedId(id)
    return id
  }

  async function handleSave() {
    setSaving("save")
    const id = await saveEstimate()
    setSaving(null)
    if (!id) return
    toast({ title: est ? "Estimate updated" : "Estimate saved", description: written?.title })
    router.push(`/estimates/${id}`)
    router.refresh()
  }

  async function handleSaveAndSend() {
    if (!pf.email.trim()) {
      toast({ title: "Add the customer's email first", description: "Fill it in under Prepared for.", variant: "destructive" })
      return
    }
    setSaving("send")
    const id = await saveEstimate()
    setSaving(null)
    if (!id || !written) return
    const std = defaultEstimateEmail(pf.name, written.title)
    setTo(pf.email.trim()); setSubject(std.subject); setBody(std.body); setTplId("")
    setSendOpen(true)
  }

  function applyTemplate(id: string) {
    setTplId(id)
    const tpl = followUpTemplates.find((t) => t.id === id)
    if (!tpl) return
    const data = {
      customer_name: pf.name, estimate_total: formatMoney(written?.total ?? 0),
      company_name: companySettings?.company_name ?? "", sender_name: companySettings?.company_name ?? "",
      sender_phone: companySettings?.phone ?? "", sender_email: companySettings?.email ?? "", review_link: companySettings?.google_review_link ?? "",
    }
    if (tpl.subject) setSubject(renderTemplate(tpl.subject, data))
    setBody(renderTemplate(tpl.body, data))
  }

  async function handleSend() {
    if (!savedId || !to) return
    setSending(true)
    try {
      const res = await fetch(`/api/estimates/${savedId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to, subject, body }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast({ title: "Failed to send", description: (data as { error?: string }).error ?? "Unknown error", variant: "destructive" }); return }
      await upsertEstimateFollowUp(createClient(), { userId, estimateId: savedId, customerId, customerName: pf.name })
      toast({ title: "Estimate sent", description: `Emailed to ${to}` })
      setSendOpen(false)
      router.push(`/estimates/${savedId}`)
      router.refresh()
    } catch {
      toast({ title: "Failed to send", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  const busy = !!writing || !!saving
  const label = "text-[11px] font-semibold uppercase tracking-[0.16em] text-[#A88532]"

  return (
    <div className="space-y-5 max-w-3xl">
      {/* ── 1. The lead card ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between gap-2">
            <span className="flex items-center gap-2"><UserRound className="w-4 h-4 text-muted-foreground" /> 1 · Lead</span>
            {customerId && (
              <Button type="button" size="sm" variant={pfDirty ? "default" : "outline"} className="gap-1.5 h-8" disabled={!pfDirty || savingPf} onClick={() => void savePreparedFor()}>
                {savingPf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : pfDirty ? <Save className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {pfDirty ? "Save to lead card" : "Matches lead card"}
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={customerId} onValueChange={(v) => setCustomerId(v)}>
            <SelectTrigger><SelectValue placeholder="Pick the lead card" /></SelectTrigger>
            <SelectContent>
              {customerList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {customerId && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {([
                ["name", "Full name", "text", "Maria Gonzalez"],
                ["phone", "Phone", "tel", "(760) 555-0123"],
                ["email", "Email", "email", "customer@email.com"],
                ["address", "Address", "text", "Street, City, CA ZIP"],
              ] as const).map(([key, lbl, type, ph]) => (
                <div key={key} className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{lbl}</label>
                  <Input
                    type={type}
                    value={pf[key]}
                    placeholder={ph}
                    onChange={(e) => { setPf((v) => ({ ...v, [key]: e.target.value })); setPfDirty(true) }}
                    className={cn("h-9", key === "email" && !pf.email.trim() && "border-amber-500/60 bg-amber-500/5")}
                  />
                  {key === "email" && !pf.email.trim() && <p className="text-[11px] text-amber-700 dark:text-amber-400">No email yet — add it to send the estimate.</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── 2. Short description → AI writes the estimate ─────────────── */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> 2 · Describe the job</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            className="min-h-[150px] text-sm"
            placeholder={"A short note is enough — what you're doing, the total, and the payments. For example:\n\nkitchen remodel, demo old kitchen and drywall, new drywall, new plumbing line, 10 shaker cabinets, island with sink and dishwasher, granite countertop, recessed lights, vent, flooring in missing places. total 48777, 5 payments: 10000 demo, 20000 material arrival, 5000 cabinets and plumbing done, 5000 flooring done, 8777 completion"}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={() => runAI("write")} disabled={busy || brief.trim().length < 8} className="gap-1.5">
              {writing === "write" ? <Loader2 className="w-4 h-4 animate-spin" /> : written ? <RotateCcw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
              {writing === "write" ? "Writing the estimate… (about 20 seconds)" : written ? "Write it again from scratch" : "Write the estimate"}
            </Button>
            {!written && !writing && <p className="text-xs text-muted-foreground">Writes the title, the full detailed scope of work, the payment schedule and the notes.</p>}
          </div>
        </CardContent>
      </Card>

      {/* ── 3. The estimate, as it will look ───────────────────────────── */}
      {written && (
        <Card className={cn(writing && "opacity-60 pointer-events-none")}>
          <CardContent className="pt-6 space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={label}>Project</p>
                <h2 className="text-xl font-bold mt-1">{written.title}</h2>
              </div>
              <div className="text-right">
                <p className={label}>Total</p>
                <p className="text-2xl font-bold tabular-nums mt-0.5">{written.total ? formatMoney(written.total) : "—"}</p>
              </div>
            </div>

            <section>
              <p className={label}>Scope of work</p>
              <div className="mt-3 space-y-4">
                {written.sections.map((sec, i) => (
                  <div key={i}>
                    <h3 className="flex items-center gap-2.5 font-semibold text-[15px]">
                      <span className="grid place-items-center w-6 h-6 rounded-full bg-foreground text-background text-[11px] shrink-0">{i + 1}</span>
                      {sec.heading}
                    </h3>
                    <ul className="mt-1.5 ml-9 space-y-1">
                      {sec.bullets.map((b, k) => (
                        <li key={k} className="text-sm leading-relaxed text-muted-foreground flex gap-2.5"><span className="mt-[7px] w-1.5 h-1.5 bg-[#C9A246] shrink-0" />{b}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <p className={label}>Payment schedule</p>
              <div className={cn("mt-3 rounded-lg border overflow-hidden", (noPayments || paymentsOff) && "border-destructive/60")}>
                {steps.map((p, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 px-4 py-3 border-b">
                    <div className="flex gap-3 min-w-0">
                      <span className="text-muted-foreground font-semibold text-sm w-4 shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{p.name}</p>
                        {p.description && <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>}
                      </div>
                    </div>
                    <span className="font-semibold text-sm tabular-nums shrink-0">{formatMoney(p.amount)}</span>
                  </div>
                ))}
                {noPayments && <p className="px-4 py-3 text-sm text-destructive border-b">No payment steps yet.</p>}
                <div className="flex items-center justify-between bg-[#1E2320] px-4 py-3">
                  <span className="text-white text-xs font-bold tracking-[0.14em]">TOTAL CONTRACT PRICE</span>
                  <span className="text-[#C9A246] text-lg font-bold tabular-nums">{written.total ? formatMoney(written.total) : "—"}</span>
                </div>
              </div>
              {!problem && <p className="mt-2 flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="w-4 h-4" /> {steps.length} payments add up to the total.</p>}
            </section>

            {written.notes.length > 0 && (
              <section className="rounded-lg bg-muted/60 p-4">
                <p className={label}>Project notes</p>
                <ul className="mt-2 space-y-1">
                  {written.notes.map((n, i) => <li key={i} className="text-sm flex gap-2.5"><span className="mt-[7px] w-1.5 h-1.5 bg-[#C9A246] shrink-0" />{n}</li>)}
                </ul>
              </section>
            )}

            {problem && (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/40 bg-destructive/5 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{problem}
              </div>
            )}

            {/* Changes in plain words */}
            <div className="rounded-lg border border-dashed p-3 space-y-2">
              <label className="text-sm font-medium flex items-center gap-1.5"><Wand2 className="w-4 h-4 text-primary" /> Want something changed?</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  value={change}
                  onChange={(e) => setChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void runAI("change") } }}
                  placeholder="e.g. add a section for removing the old concrete · make the deposit 5000 and the last payment 13777"
                  className="h-10"
                />
                <Button type="button" variant="outline" onClick={() => runAI("change")} disabled={busy || !change.trim()} className="gap-1.5 shrink-0">
                  {writing === "change" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                  {writing === "change" ? "Changing…" : "Change it"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 4. Save / send ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={handleSaveAndSend} disabled={busy || !written || !!problem || !customerId} className="gap-1.5">
          {saving === "send" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Save &amp; Send
        </Button>
        <Button type="button" variant="outline" onClick={handleSave} disabled={busy || !written || !!problem || !customerId} className="gap-1.5">
          {saving === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {est ? "Save changes" : "Save draft"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>

      {/* Send */}
      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Send Estimate</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            {followUpTemplates.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Template (optional)</label>
                <Select value={tplId} onValueChange={applyTemplate}>
                  <SelectTrigger><SelectValue placeholder="Standard estimate email" /></SelectTrigger>
                  <SelectContent>{followUpTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message <span className="normal-case font-normal">(edit before sending)</span></label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[160px] text-sm" />
            </div>
            <p className="text-xs text-muted-foreground">Sent as a branded email with a <b>Review &amp; Sign Estimate</b> button and the PDF attached. Valid for {ESTIMATE_VALID_DAYS} days from today.</p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !to || !body}>
              {sending ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</> : <><Send className="w-4 h-4 mr-1.5" />Send Estimate</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
