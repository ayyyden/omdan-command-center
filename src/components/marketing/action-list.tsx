"use client"

// The Ad Advisor's to-do list: what to do today (urgent first), each with
// the reason. Every suggestion can be edited, marked done, dismissed or
// deleted; several at once can be selected, and "Clear all" empties the list.
// Done records the numbers at that moment; 7 days later the sync records
// them again and the card shows what changed.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Check, X, RotateCcw, Loader2, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
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

const SHOW_FIRST = 5

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
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showAll, setShowAll] = useState(false)

  const open = actions.filter((a) => a.status === "open")
    .sort((a, b) => (a.urgency === "urgent" ? 0 : a.urgency === "normal" ? 1 : 2) - (b.urgency === "urgent" ? 0 : b.urgency === "normal" ? 1 : 2) || b.created_at.localeCompare(a.created_at))
  const visible = showAll ? open : open.slice(0, SHOW_FIRST)
  const done = actions.filter((a) => a.status === "done").slice(0, 8)

  async function call(url: string, init: RequestInit, okTitle?: string): Promise<boolean> {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      toast({ title: "Not saved", description: d.error ?? "Try again", variant: "destructive" })
      return false
    }
    if (okTitle) toast({ title: okTitle })
    router.refresh()
    return true
  }

  async function setStatus(a: AdAction, status: AdAction["status"]) {
    setBusy(a.id)
    await call(`/api/meta-ads/actions/${a.id}`, { method: "PATCH", body: JSON.stringify({ status }) },
      status === "done" ? "Marked done. I'll compare the numbers again in 7 days." : undefined)
    setBusy(null)
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(editing.id)
    const ok = await call(`/api/meta-ads/actions/${editing.id}`, { method: "PATCH", body: JSON.stringify({ text: editing.text }) }, "Saved")
    setBusy(null)
    if (ok) setEditing(null)
  }

  async function remove(a: AdAction) {
    setBusy(a.id)
    await call(`/api/meta-ads/actions/${a.id}`, { method: "DELETE" }, "Deleted")
    setBusy(null)
  }

  async function bulk(op: "delete" | "dismiss", allOpen: boolean) {
    if (allOpen && !window.confirm(`Clear all ${open.length} suggestions? New ones come with the next review.`)) return
    setBusy("bulk")
    const ok = await call("/api/meta-ads/actions", { method: "POST", body: JSON.stringify({ op, ids: [...selected], all_open: allOpen }) },
      allOpen ? "List cleared" : `${op === "delete" ? "Deleted" : "Dismissed"} ${selected.size}`)
    setBusy(null)
    if (ok) setSelected(new Set())
  }

  const toggle = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n })
  const allVisibleSelected = visible.length > 0 && visible.every((a) => selected.has(a.id))

  if (!open.length && !done.length) {
    return <p className="text-sm text-muted-foreground">Nothing to do right now. New suggestions come with the next review.</p>
  }

  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={allVisibleSelected}
                onChange={(e) => setSelected(e.target.checked ? new Set(visible.map((a) => a.id)) : new Set())} />
              <span className="text-muted-foreground">{selected.size ? `${selected.size} selected` : "Select"}</span>
            </label>
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="outline" onClick={() => bulk("dismiss", false)} disabled={busy === "bulk"}><X className="w-3.5 h-3.5" /> Dismiss</Button>
                <Button size="sm" variant="outline" onClick={() => bulk("delete", false)} disabled={busy === "bulk"} className="text-destructive"><Trash2 className="w-3.5 h-3.5" /> Delete</Button>
              </>
            )}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => bulk("dismiss", true)} disabled={busy === "bulk"}>
              {busy === "bulk" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Clear all ({open.length})
            </Button>
          </div>

          <ul className="space-y-2">
            {visible.map((a) => (
              <li key={a.id} className={cn("rounded-lg border p-3 flex gap-3", a.urgency === "urgent" && "border-destructive/40 bg-destructive/[0.04]", selected.has(a.id) && "ring-1 ring-primary/40")}>
                <input type="checkbox" className="h-4 w-4 mt-1 accent-primary shrink-0" checked={selected.has(a.id)} onChange={(e) => toggle(a.id, e.target.checked)} aria-label="Select suggestion" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    {a.urgency === "urgent" && <span className="font-semibold text-destructive">Urgent</span>}
                    <span className="font-medium text-foreground">{TYPE_LABELS[a.type] ?? a.type}</span>
                    {a.entity_name && <span className="truncate">{a.entity_name}</span>}
                    {a.confidence && <span>{a.confidence} confidence</span>}
                  </div>
                  {editing?.id === a.id ? (
                    <div className="mt-2 space-y-2">
                      <Textarea value={editing.text} onChange={(e) => setEditing({ id: a.id, text: e.target.value })} rows={3} autoFocus />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={saveEdit} disabled={busy === a.id}>{busy === a.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm mt-1">{a.text}</p>
                  )}
                  {a.reason && editing?.id !== a.id && <p className="text-xs text-muted-foreground mt-1">{a.reason}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <Button size="sm" onClick={() => setStatus(a, "done")} disabled={!!busy}>
                    {busy === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Done
                  </Button>
                  <div className="flex">
                    <IconButton label="Edit" onClick={() => setEditing({ id: a.id, text: a.text })}><Pencil className="w-3.5 h-3.5" /></IconButton>
                    <IconButton label="Dismiss" onClick={() => setStatus(a, "dismissed")}><X className="w-3.5 h-3.5" /></IconButton>
                    <IconButton label="Delete" onClick={() => remove(a)} danger><Trash2 className="w-3.5 h-3.5" /></IconButton>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {open.length > SHOW_FIRST && (
            <button onClick={() => setShowAll((v) => !v)} className="text-sm text-muted-foreground hover:text-foreground">
              {showAll ? "Show fewer" : `Show ${open.length - SHOW_FIRST} more`}
            </button>
          )}
        </>
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
                    <div className="flex shrink-0">
                      <IconButton label="Mark as not done" onClick={() => setStatus(a, "open")}><RotateCcw className="w-3.5 h-3.5" /></IconButton>
                      <IconButton label="Delete" onClick={() => remove(a)} danger><Trash2 className="w-3.5 h-3.5" /></IconButton>
                    </div>
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

function IconButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className={cn("grid place-items-center w-8 h-8 rounded-md text-muted-foreground hover:bg-muted", danger ? "hover:text-destructive" : "hover:text-foreground")}>
      {children}
    </button>
  )
}
