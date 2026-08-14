"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetaLeadColumn } from "@/components/meta-leads/meta-lead-column"
import type { MetaLead, MetaLeadsGrouped } from "@/types"

const EMPTY: MetaLeadsGrouped = {
  call_list: [], second_call_list: [], schedule_call_list: [], scheduled: [], archive: [],
}

export function MetaLeadsWorkspace() {
  const [data, setData] = useState<MetaLeadsGrouped>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
        {/* Mobile: 3 stacked sections, each independently scrollable (see MetaLeadColumn).
            Desktop: side-by-side kanban columns filling the page height. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:h-full">
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
