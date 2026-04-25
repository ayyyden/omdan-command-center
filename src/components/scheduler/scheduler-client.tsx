"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SchedulerGrid } from "./scheduler-grid"
import { ChevronLeft, ChevronRight, CalendarDays, AlertTriangle } from "lucide-react"

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export interface SchedulerJob {
  id: string
  title: string
  scheduled_date: string
  scheduled_time: string | null
  status: string
  project_manager_id: string | null
  estimated_duration_minutes: number | null
  customer_id: string
  customer: { name: string } | null
}

export interface PmInfo {
  id: string
  name: string
  color: string
}

export interface SchedulerReminder {
  id: string
  title: string
  due_date: string
  due_time: string | null
  type: string
  completed_at: string | null
  notes: string | null
  duration_minutes: number
}

interface SchedulerClientProps {
  jobs: SchedulerJob[]
  pms: PmInfo[]
  reminders: SchedulerReminder[]
  date: string
  todayLA: string
  userId: string
}

export function SchedulerClient({ jobs, pms, reminders, date, todayLA, userId }: SchedulerClientProps) {
  const router = useRouter()
  const isToday = date === todayLA
  const carriedCount = jobs.filter((j) => j.scheduled_date < date).length

  function navigate(newDate: string) {
    router.push(`/scheduler?date=${newDate}`)
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Navigation bar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b bg-card shrink-0 flex-wrap">
        {/* Arrow + Today controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => navigate(addDays(date, -1))}
            aria-label="Previous day"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <Button
            variant={isToday ? "default" : "ghost"}
            size="sm"
            onClick={() => navigate(todayLA)}
            className="h-8 gap-1.5 px-3 rounded-lg font-medium"
          >
            <CalendarDays className="w-3.5 h-3.5" />
            Today
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            onClick={() => navigate(addDays(date, 1))}
            aria-label="Next day"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        <div className="w-px h-5 bg-border shrink-0" />

        {/* Date picker — dark:[color-scheme:dark] makes the native widget use dark styling in dark mode */}
        <Input
          type="date"
          value={date}
          onChange={(e) => { if (e.target.value) navigate(e.target.value) }}
          className="w-[140px] h-8 text-sm cursor-pointer border-border bg-muted/40 rounded-lg dark:[color-scheme:dark]"
        />

        {/* Day label */}
        <span className="text-sm font-semibold text-foreground hidden sm:block">
          {formatDayLabel(date)}
        </span>

        {/* Carried jobs badge */}
        {carriedCount > 0 && (
          <div className="ml-auto flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800/50">
            <AlertTriangle className="w-3 h-3" />
            {carriedCount} carried job{carriedCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Time grid */}
      <SchedulerGrid
        jobs={jobs}
        pms={pms}
        reminders={reminders}
        viewingDate={date}
        userId={userId}
      />
    </div>
  )
}
