"use client"

import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { X } from "lucide-react"
import type { ProjectManager } from "@/types"

interface ReportsFiltersProps {
  currentFrom: string
  currentTo: string
  currentPm: string
  currentStatus: string
  projectManagers: ProjectManager[]
}

function makeUrl(params: Record<string, string>) {
  const p = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v && v !== "all") p.set(k, v) })
  const qs = p.toString()
  return `/reports${qs ? `?${qs}` : ""}`
}

export function ReportsFilters({
  currentFrom,
  currentTo,
  currentPm,
  currentStatus,
  projectManagers,
}: ReportsFiltersProps) {
  const router = useRouter()

  function update(key: string, value: string) {
    router.push(makeUrl({
      from:   key === "from"   ? value : currentFrom,
      to:     key === "to"     ? value : currentTo,
      pm:     key === "pm"     ? value : currentPm,
      status: key === "status" ? value : currentStatus,
    }))
  }

  function applyPreset(preset: "month" | "year" | "6m" | "all") {
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    if (preset === "all") { router.push("/reports"); return }
    if (preset === "month") {
      const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`
      router.push(makeUrl({ from, to: today, pm: currentPm, status: currentStatus }))
      return
    }
    if (preset === "year") {
      const from = `${now.getFullYear()}-01-01`
      router.push(makeUrl({ from, to: today, pm: currentPm, status: currentStatus }))
      return
    }
    if (preset === "6m") {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 6)
      const from = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      router.push(makeUrl({ from, to: today, pm: currentPm, status: currentStatus }))
    }
  }

  const hasFilters = !!(currentFrom || currentTo || (currentPm && currentPm !== "all") || (currentStatus && currentStatus !== "all"))

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Date presets */}
      <div className="flex items-center gap-1">
        {(["month", "year", "6m", "all"] as const).map((p) => {
          const labels = { month: "This Month", year: "This Year", "6m": "Last 6M", all: "All Time" }
          return (
            <Button
              key={p}
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => applyPreset(p)}
            >
              {labels[p]}
            </Button>
          )
        })}
      </div>

      <div className="w-px h-6 bg-border" />

      {/* Date range */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">From</span>
        <Input
          type="date"
          value={currentFrom}
          onChange={(e) => update("from", e.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">To</span>
        <Input
          type="date"
          value={currentTo}
          onChange={(e) => update("to", e.target.value)}
          className="h-8 w-36 text-xs"
        />
      </div>

      {/* PM filter */}
      <Select value={currentPm || "all"} onValueChange={(v) => update("pm", v)}>
        <SelectTrigger className="h-8 w-40 text-xs">
          <SelectValue placeholder="All PMs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All PMs</SelectItem>
          {projectManagers.map((pm) => (
            <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Status filter */}
      <Select value={currentStatus || "all"} onValueChange={(v) => update("status", v)}>
        <SelectTrigger className="h-8 w-36 text-xs">
          <SelectValue placeholder="All Statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Statuses</SelectItem>
          <SelectItem value="scheduled">Scheduled</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="on_hold">On Hold</SelectItem>
        </SelectContent>
      </Select>

      {hasFilters && (
        <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground" onClick={() => router.push("/reports")}>
          <X className="w-3 h-3" />
          Clear
        </Button>
      )}
    </div>
  )
}
