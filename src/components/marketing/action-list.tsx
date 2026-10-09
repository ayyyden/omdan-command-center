"use client"

// The Ad Advisor's to-do list: what to do today (urgent first), each with
// the reason. Done records the numbers at that moment; 7 days later the
// sync records them again and the card shows what changed.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, X, RotateCcw, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate } from "@/lib/utils"

export interface AdAction {
  id: string
  entity_name: string | null
  entity_level: string | null
  type: string
  text: string
  reason: string | null
  confidence: string | null
  urgency: "urgent" | "normal" | "low"
  status: "open" | "done" | "dismissed"
  done_at: string | null
  metrics_at_done: Snapshot | null
  metrics_after_7d: (Snapshot & { unavailable?: boolean }) | null
  created_at: string
}

interface Snapshot { spend?: number; leads?: number; cpl?: number | null; ctr?: number | null; frequency_7d?: number | null; contact_rate?: number | null }

const TYPE_LABELS: Record<string, string> = {
  creative_refresh: "New creative", new_test: "Run a test", form_fix: "Fix the form", audience: "Audience",
  budget_up: "Raise budget", budget_down: "Lower budget", pause: "Pause", follow_up: "Follow up", tracking: "Tracking",
}

function delta(label: string, before: number | null | undefined, after: number | null | undefined, fmt: (n: number) => string, lowerIsBetter = false) {
  if (before == null || after == null) return null
  const better = lowerIsBetter ? after < before : after > before
  const same = Math.abs(after - before) < 1e-9
  return (
    <span className="whitespace-nowrap">
      {label} {fmt(before)} → <span className={cn("font-medium", same ? "" : better ? "text-success" : "text-destructive")}>{fmt(after)}</span>
    </span>
  )
}

export function ActionList({ actions }: { actions: AdAction[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  async function setStatus(a: AdAction, status: AdAction["status"]) {
    setBusy(a.id)
    const res = await fetch(`/api/meta-ads/actions/${a.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    })
    setBusy(null)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast({ title: "Not saved", description: d.error ?? "Try again", variant: "destructive" })
      return
    }
    if (status === "done") toast({ title: "Marked done", description: "I'll compare the numbers again in 7 days." })
    router.refresh()
  }

  const open = actions.filter((a) => a.status === "open")
    .sort((a, b) => (a.urgency === "urgent" ? 0 : 1) - (b.urgency === "urgent" ? 0 : 1) || b.created_at.localeCompare(a.created_at))
  const done = actions.filter((a) => a.status === "done").slice(0, 8)

  if (!open.length && !done.length) {
    return <p className="text-sm text-muted-foreground">No actions yet. They appear after the first daily review.</p>
  }

  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <ul className="space-y-2">
          {open.map((a) => (
            <li key={a.id} className={cn("rounded-lg border p-3 flex gap-3", a.urgency === "urgent" && "border-destructive/40 bg-destructive/[0.04]")}>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {a.urgency === "urgent" && <span className="font-semibold text-destructive">Urgent</span>}
                  <span className="font-medium text-foreground">{TYPE_LABELS[a.type] ?? a.type}</span>
                  {a.entity_name && <span className="truncate">{a.entity_name}</span>}
                  {a.confidence && <span>{a.confidence} confidence</span>}
                </div>
                <p className="text-sm mt-1">{a.text}</p>
                {a.reason && <p className="text-xs text-muted-foreground mt-1">{a.reason}</p>}
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                <Button size="sm" onClick={() => setStatus(a, "done")} disabled={busy === a.id}>
                  {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Done
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus(a, "dismissed")} disabled={busy === a.id}>
                  <X className="w-3.5 h-3.5" /> Dismiss
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Done recently: did it work?</p>
          <ul className="space-y-2">
            {done.map((a) => {
              const b = a.metrics_at_done, af = a.metrics_after_7d
              const money = (n: number) => `$${n.toFixed(2)}`
              return (
                <li key={a.id} className="rounded-lg border bg-muted/30 p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0"><span className="font-medium">{a.entity_name}</span>: {a.text}</p>
                    <button onClick={() => setStatus(a, "open")} className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1" title="Mark as not done">
                      <RotateCcw className="w-3 h-3" /> Undo
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Done {a.done_at ? formatDate(a.done_at) : ""}</span>
                    {!af && <span>Results in 7 days</span>}
                    {af?.unavailable && <span>No data after 7 days (ad no longer running)</span>}
                    {af && !af.unavailable && b && (
                      <>
                        {delta("Cost per lead", b.cpl, af.cpl, money, true)}
                        {delta("Click rate", b.ctr, af.ctr, (n) => `${n.toFixed(2)}%`)}
                        {delta("Leads/wk", b.leads, af.leads, (n) => String(n))}
                        {delta("Frequency", b.frequency_7d, af.frequency_7d, (n) => n.toFixed(1), true)}
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
