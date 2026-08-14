"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetaLeadColumn } from "@/components/meta-leads/meta-lead-column"
import { cn } from "@/lib/utils"
import type { MetaLead, MetaLeadsGrouped } from "@/types"

const EMPTY: MetaLeadsGrouped = {
  call_list: [], second_call_list: [], schedule_call_list: [], scheduled: [], archive: [],
}

type ActiveListKey = "schedule_call_list" | "call_list" | "second_call_list"

const ACTIVE_LISTS: Array<{ key: ActiveListKey; label: string; shortLabel: string; title: string; emptyLabel: string }> = [
  { key: "schedule_call_list", label: "Schedule Call List", shortLabel: "Schedule", title: "Schedule Call List", emptyLabel: "No calls scheduled for later." },
  { key: "call_list",          label: "Call List",          shortLabel: "Call List", title: "Call List",          emptyLabel: "No leads to call right now." },
  { key: "second_call_list",   label: "Second Call List",   shortLabel: "2nd Call",  title: "Second Call List",   emptyLabel: "No missed calls waiting." },
]

export function MetaLeadsWorkspace() {
  const [data, setData] = useState<MetaLeadsGrouped>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mobileList, setMobileList] = useState<ActiveListKey>("call_list")

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/meta-leads")
      if (!res.ok) {
        const body = await res.json() as { error?: string }
        setError(body.error ?? "Failed to load leads")
        return
      }
      const body = await res.json() as MetaLeadsGrouped
      setData(body)
    } catch {
      setError("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const handler = () => load()
    window.addEventListener("meta-leads-refresh", handler)
    return () => window.removeEventListener("meta-leads-refresh", handler)
  }, [load])

  function handleUpdated(updated: MetaLead) {
    setData((prev) => {
      const next: MetaLeadsGrouped = {
        call_list: prev.call_list.filter((l) => l.id !== updated.id),
        second_call_list: prev.second_call_list.filter((l) => l.id !== updated.id),
        schedule_call_list: prev.schedule_call_list.filter((l) => l.id !== updated.id),
        scheduled: prev.scheduled.filter((l) => l.id !== updated.id),
        archive: prev.archive.filter((l) => l.id !== updated.id),
      }
      next[updated.list].unshift(updated)
      return next
    })
  }

  function handleDeleted(id: string) {
    setData((prev) => ({
      call_list: prev.call_list.filter((l) => l.id !== id),
      second_call_list: prev.second_call_list.filter((l) => l.id !== id),
      schedule_call_list: prev.schedule_call_list.filter((l) => l.id !== id),
      scheduled: prev.scheduled.filter((l) => l.id !== id),
      archive: prev.archive.filter((l) => l.id !== id),
    }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading…
      </div>
    )
  }

  if (error) {
    return <p className="text-sm text-destructive p-4">{error}</p>
  }

  return (
    <Tabs defaultValue="active" className="flex flex-col md:h-full">
      <TabsList className="shrink-0 w-fit">
        <TabsTrigger value="active">Active</TabsTrigger>
        <TabsTrigger value="scheduled">Scheduled ({data.scheduled.length})</TabsTrigger>
        <TabsTrigger value="archive">Archive ({data.archive.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="active" className="flex-1 min-h-0 mt-3">
        {/* Mobile: one list at a time via a switcher, no internal scroll box —
            the page itself is the only scrollable surface (nested scroll
            boxes were trapping the scroll gesture on iOS). */}
        <div className="md:hidden space-y-3">
          <div className="flex rounded-lg border overflow-hidden text-xs font-medium">
            {ACTIVE_LISTS.map(({ key, shortLabel }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMobileList(key)}
                className={cn(
                  "flex-1 px-2 py-2 transition-colors",
                  mobileList === key
                    ? "bg-primary text-primary-foreground"
                    : "bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                {shortLabel} ({data[key].length})
              </button>
            ))}
          </div>
          {ACTIVE_LISTS.filter((l) => l.key === mobileList).map((l) => (
            <MetaLeadColumn
              key={l.key}
              title={l.title}
              leads={data[l.key]}
              emptyLabel={l.emptyLabel}
              onUpdated={handleUpdated}
              onDeleted={handleDeleted}
              noMobileCap
            />
          ))}
        </div>

        {/* Desktop: unchanged side-by-side kanban columns filling the page height. */}
        <div className="hidden md:grid md:grid-cols-3 gap-4 h-full">
          <MetaLeadColumn
            title="Schedule Call List"
            leads={data.schedule_call_list}
            emptyLabel="No calls scheduled for later."
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
          <MetaLeadColumn
            title="Call List"
            leads={data.call_list}
            emptyLabel="No leads to call right now."
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
          <MetaLeadColumn
            title="Second Call List"
            leads={data.second_call_list}
            emptyLabel="No missed calls waiting."
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
          />
        </div>
      </TabsContent>

      <TabsContent value="scheduled" className="flex-1 min-h-0 mt-3">
        <MetaLeadColumn
          title="Scheduled"
          leads={data.scheduled}
          emptyLabel="No scheduled appointments yet."
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          noMobileCap
        />
      </TabsContent>

      <TabsContent value="archive" className="flex-1 min-h-0 mt-3">
        <MetaLeadColumn
          title="Archive"
          leads={data.archive}
          emptyLabel="No archived leads."
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
          noMobileCap
        />
      </TabsContent>
    </Tabs>
  )
}
