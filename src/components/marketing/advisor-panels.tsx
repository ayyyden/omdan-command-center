"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import { Loader2, RefreshCw, Copy, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate } from "@/lib/utils"
import type { AdSettings } from "@/lib/meta-ads-settings"

// ── Trend ──────────────────────────────────────────────────────────────────

export function TrendChart({ data }: { data: { date: string; spend: number; leads: number; cpl: number | null }[] }) {
  if (!data.some((d) => d.spend > 0)) return <p className="text-sm text-muted-foreground">No spend in the last 30 days.</p>
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data.map((d) => ({ ...d, label: d.date.slice(5) }))} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
        <YAxis yAxisId="money" tick={{ fontSize: 11 }} tickFormatter={(v) => `$${v}`} width={48} />
        <YAxis yAxisId="leads" orientation="right" tick={{ fontSize: 11 }} allowDecimals={false} width={28} />
        <Tooltip
          formatter={(v, name) => name === "Leads" ? [v, name] : [`$${Number(v).toFixed(2)}`, name]}
          contentStyle={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12 }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar yAxisId="money" dataKey="spend" name="Spend" fill="#B8913A" radius={[3, 3, 0, 0]} />
        <Line yAxisId="leads" dataKey="leads" name="Leads" stroke="#35607A" strokeWidth={2} dot={false} />
        <Line yAxisId="money" dataKey="cpl" name="Cost per lead" stroke="#A9392A" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ── Report history ─────────────────────────────────────────────────────────

export interface ReportRow {
  id: string
  period: "daily" | "weekly" | "monthly"
  period_start: string
  period_end: string
  summary: string | null
  payload: { entities?: { name: string; verdict: string; confidence: string; reason: string }[]; regions?: RegionLite[] | null }
  created_at: string
}
interface RegionLite { region: string; leads: number; appointments: number; sales: number; cost_per_appointment: { value: number | null; status: string }; cost_per_sale: { value: number | null; status: string } }

export function ReportHistory({ reports }: { reports: ReportRow[] }) {
  const [tab, setTab] = useState<ReportRow["period"]>("daily")
  const list = reports.filter((r) => r.period === tab)
  return (
    <div>
      <div className="inline-flex rounded-[var(--radius-control)] bg-muted p-1 mb-3">
        {(["daily", "weekly", "monthly"] as const).map((p) => (
          <button key={p} onClick={() => setTab(p)}
            className={cn("px-3 py-1 text-sm rounded-[calc(var(--radius-control)-3px)] capitalize", tab === p ? "bg-background shadow-sm font-medium" : "text-muted-foreground")}>
            {p}
          </button>
        ))}
      </div>
      {!list.length && <p className="text-sm text-muted-foreground">No {tab} reports yet.</p>}
      <ul className="space-y-3">
        {list.slice(0, 10).map((r) => (
          <li key={r.id} className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">
              {r.period_start === r.period_end ? formatDate(r.period_start) : `${formatDate(r.period_start)} – ${formatDate(r.period_end)}`}
            </p>
            {r.summary && <p className="text-sm mt-1">{r.summary}</p>}
            {!!r.payload.entities?.length && (
              <ul className="mt-2 space-y-1 text-xs">
                {r.payload.entities.map((e, i) => (
                  <li key={i}><span className="font-medium capitalize">{e.verdict}</span> ({e.confidence}) {e.name}: <span className="text-muted-foreground">{e.reason}</span></li>
                ))}
              </ul>
            )}
            {!!r.payload.regions?.length && (
              <div className="mt-2 text-xs text-muted-foreground">
                {r.payload.regions.map((g) => (
                  <span key={g.region} className="mr-3 inline-block">{g.region}: {g.leads} leads, {g.appointments} appts, {g.sales} sold</span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Sync / review buttons ──────────────────────────────────────────────────

export function SyncButtons({ configured }: { configured: boolean }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function run(kind: "sync" | "review") {
    setBusy(kind)
    const res = await fetch(kind === "sync" ? "/api/meta-ads/sync" : "/api/meta-ads/review?period=daily", { method: "POST" })
    const d = await res.json().catch(() => ({}))
    setBusy(null)
    if (!res.ok) { toast({ title: kind === "sync" ? "Sync failed" : "Review failed", description: d.error ?? "Try again", variant: "destructive" }); return }
    toast(kind === "sync"
      ? { title: "Synced", description: `${d.entities ?? 0} campaigns/ad sets/ads, ${d.insight_rows ?? 0} daily rows${d.errors?.length ? `. Problems: ${d.errors.join("; ")}` : ""}` }
      : { title: "Daily review done", description: d.skipped_reason ?? `${d.actions} action${d.actions === 1 ? "" : "s"}` })
    router.refresh()
  }

  return (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => run("sync")} disabled={!!busy || !configured}>
        {busy === "sync" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sync now
      </Button>
      <Button size="sm" onClick={() => run("review")} disabled={!!busy || !configured}>
        {busy === "review" && <Loader2 className="w-4 h-4 animate-spin" />} Review now
      </Button>
    </div>
  )
}

// ── Settings ───────────────────────────────────────────────────────────────

const FIELDS: { key: keyof AdSettings; label: string; hint: string; prefix?: string; suffix?: string }[] = [
  { key: "target_cpl", label: "Target cost per lead", hint: "What a lead is worth paying", prefix: "$" },
  { key: "target_cost_per_appointment", label: "Target cost per appointment", hint: "Per booked estimate", prefix: "$" },
  { key: "avg_job_value", label: "Average job value", hint: "Used to judge cost per sale", prefix: "$" },
  { key: "appointment_maturity_days", label: "Appointment maturity", hint: "Leads younger than this aren't judged on appointments", suffix: "days" },
  { key: "sale_maturity_days", label: "Sale maturity", hint: "Leads younger than this aren't judged on sales", suffix: "days" },
  { key: "min_call_attempts", label: "Calls before 'not reached'", hint: "A lead only counts as unreachable after this many calls", suffix: "calls" },
  { key: "spend_no_lead_multiple", label: "Money-burning alert", hint: "Alert when spend with 0 leads reaches this × target CPL", suffix: "×" },
  { key: "cpl_spike_multiple", label: "Cost-per-lead spike", hint: "Alert when CPL jumps to this × normal", suffix: "×" },
  { key: "frequency_limit", label: "Frequency limit", hint: "Times a person sees the ad in a week", suffix: "×" },
  { key: "ctr_drop_pct", label: "Click-rate drop", hint: "Week-over-week drop that means the creative is tired", suffix: "%" },
  { key: "quiet_start_hour", label: "Quiet hours start", hint: "No non-critical alerts from this hour (0–23)" },
  { key: "quiet_end_hour", label: "Quiet hours end", hint: "Held alerts are sent at this hour" },
]

export function SettingsForm({ settings }: { settings: AdSettings }) {
  const router = useRouter()
  const { toast } = useToast()
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.key, String(settings[f.key])])))
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const res = await fetch("/api/meta-ads/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) })
    const d = await res.json().catch(() => ({}))
    setSaving(false)
    if (!res.ok) { toast({ title: "Not saved", description: d.error, variant: "destructive" }); return }
    toast({ title: "Settings saved" })
    router.refresh()
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
        {FIELDS.map((f) => (
          <div key={f.key} className="space-y-1">
            <Label htmlFor={f.key}>{f.label}</Label>
            <div className="flex items-center gap-2">
              {f.prefix && <span className="text-sm text-muted-foreground">{f.prefix}</span>}
              <Input id={f.key} inputMode="decimal" value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} className="max-w-[140px]" />
              {f.suffix && <span className="text-sm text-muted-foreground">{f.suffix}</span>}
            </div>
            <p className="text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>
      <Button type="submit" disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} Save settings</Button>
    </form>
  )
}

// ── Setup guide ────────────────────────────────────────────────────────────

export function CopyText({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2">
      <code className="flex-1 break-all text-xs">{text}</code>
      <button type="button" onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
        className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Copy">
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  )
}
