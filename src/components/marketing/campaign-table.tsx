"use client"

// Campaigns with their ads underneath (tap to open). Cost per appointment /
// per sale show "too early" until the leads are old enough to judge.

import { Fragment, useState } from "react"
import { ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { EntityMetrics, Matured } from "@/lib/meta-ads-metrics"

export interface TableEntity {
  id: string
  name: string
  status: string | null
  daily_budget: number | null
  thumbnail_url: string | null
  metrics: EntityMetrics
  verdict: string | null
  confidence: string | null
  verdict_reason: string | null
  ads: TableEntity[]
}

const VERDICT_STYLE: Record<string, string> = {
  scale: "bg-success/15 text-success", keep: "bg-muted text-muted-foreground", watch: "bg-[var(--info,#35607A)]/15 text-[var(--info,#35607A)]",
  fix: "bg-warning/15 text-warning", pause: "bg-destructive/15 text-destructive",
}

const money = (n: number | null | undefined, digits = 2) => n == null ? "—" : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

function MaturedCell({ m }: { m: Matured }) {
  if (m.status === "too_early") return <span className="text-muted-foreground" title={`Needs leads at least ${m.maturity_days} days old`}>too early</span>
  if (m.status === "none") return <span className="text-muted-foreground" title={`${money(m.mature_spend, 0)} spent on ${m.mature_leads} mature leads`}>none yet ({m.mature_leads})</span>
  return <span title={`${m.events} from ${m.mature_leads} leads ${m.maturity_days}+ days old`}>{money(m.value, 0)}</span>
}

function Verdict({ e }: { e: TableEntity }) {
  if (!e.verdict) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium capitalize", VERDICT_STYLE[e.verdict] ?? "bg-muted")} title={e.verdict_reason ?? undefined}>
      {e.verdict}{e.confidence ? <span className="ml-1 opacity-70 normal-case">· {e.confidence}</span> : null}
    </span>
  )
}

function statusLabel(s: string | null) {
  if (!s) return null
  if (s === "ACTIVE") return null
  return <span className="ml-2 text-[11px] text-muted-foreground lowercase">{s.replace(/_/g, " ")}</span>
}

function Cells({ e }: { e: TableEntity }) {
  const m = e.metrics
  return (
    <>
      <td className="px-3 py-2.5 text-right tabular-nums">{money(m.spend, 0)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{m.leads_meta}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{money(m.cpl)}</td>
      <td className="px-3 py-2.5 text-right tabular-nums"><MaturedCell m={m.cost_per_appointment} /></td>
      <td className="px-3 py-2.5 text-right tabular-nums"><MaturedCell m={m.cost_per_sale} /></td>
      <td className="px-3 py-2.5 text-right tabular-nums">{m.ctr == null ? "—" : `${m.ctr.toFixed(2)}%`}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">{m.frequency_7d == null ? "—" : m.frequency_7d.toFixed(1)}</td>
      <td className="px-3 py-2.5"><Verdict e={e} /></td>
    </>
  )
}

export function CampaignTable({ campaigns }: { campaigns: TableEntity[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (!campaigns.length) return <p className="text-sm text-muted-foreground">No campaign has spent in this period.</p>

  return (
    <>
      {/* Phone: cards */}
      <div className="sm:hidden space-y-2">
        {campaigns.map((c) => (
          <div key={c.id} className="rounded-lg border p-3">
            <button className="w-full text-left" onClick={() => toggle(c.id)}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{c.name}{statusLabel(c.status)}</p>
                <Verdict e={c} />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-y-1.5 text-xs">
                <span className="text-muted-foreground">Spend<br /><span className="text-foreground text-sm">{money(c.metrics.spend, 0)}</span></span>
                <span className="text-muted-foreground">Leads<br /><span className="text-foreground text-sm">{c.metrics.leads_meta}</span></span>
                <span className="text-muted-foreground">Per lead<br /><span className="text-foreground text-sm">{money(c.metrics.cpl)}</span></span>
                <span className="text-muted-foreground">Per appt<br /><span className="text-foreground text-sm"><MaturedCell m={c.metrics.cost_per_appointment} /></span></span>
                <span className="text-muted-foreground">Per sale<br /><span className="text-foreground text-sm"><MaturedCell m={c.metrics.cost_per_sale} /></span></span>
                <span className="text-muted-foreground">Ads<br /><span className="text-foreground text-sm">{c.ads.length}</span></span>
              </div>
              {c.verdict_reason && <p className="mt-2 text-xs text-muted-foreground">{c.verdict_reason}</p>}
            </button>
            {open.has(c.id) && c.ads.length > 0 && (
              <ul className="mt-3 space-y-2 border-t pt-3">
                {c.ads.map((a) => (
                  <li key={a.id} className="flex gap-2.5 text-xs">
                    {a.thumbnail_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2"><span className="font-medium truncate">{a.name}</span><Verdict e={a} /></div>
                      <span className="text-muted-foreground">{money(a.metrics.spend, 0)} · {a.metrics.leads_meta} leads · {money(a.metrics.cpl)}/lead</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b">
              <th className="px-3 py-2 text-left font-medium">Campaign / ad</th>
              <th className="px-3 py-2 text-right font-medium">Spend</th>
              <th className="px-3 py-2 text-right font-medium">Leads</th>
              <th className="px-3 py-2 text-right font-medium">Per lead</th>
              <th className="px-3 py-2 text-right font-medium">Per appointment</th>
              <th className="px-3 py-2 text-right font-medium">Per sale</th>
              <th className="px-3 py-2 text-right font-medium">Click rate</th>
              <th className="px-3 py-2 text-right font-medium">Frequency</th>
              <th className="px-3 py-2 text-left font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <Fragment key={c.id}>
                <tr className="border-b hover:bg-muted/40 cursor-pointer" onClick={() => toggle(c.id)}>
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <ChevronRight className={cn("w-4 h-4 text-muted-foreground transition-transform", open.has(c.id) && "rotate-90")} />
                      {c.name}{statusLabel(c.status)}
                    </span>
                    {c.daily_budget != null && <span className="block pl-[22px] text-xs text-muted-foreground">{money(c.daily_budget, 0)}/day</span>}
                  </td>
                  <Cells e={c} />
                </tr>
                {open.has(c.id) && c.ads.map((a) => (
                  <tr key={a.id} className="border-b bg-muted/20 text-[13px]">
                    <td className="px-3 py-2 pl-9">
                      <span className="flex items-center gap-2">
                        {a.thumbnail_url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={a.thumbnail_url} alt="" className="w-8 h-8 rounded object-cover" />}
                        <span>{a.name}{statusLabel(a.status)}</span>
                      </span>
                    </td>
                    <Cells e={a} />
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
