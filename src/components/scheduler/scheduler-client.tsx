"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SchedulerGrid } from "./scheduler-grid"
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react"

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
      <div className="flex items-center gap-2 px-6 py-3 border-b bg-card shrink-0 flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate(addDays(date, -1))}>
          <ChevronLeft className="w-4 h-4" />
        </Button>

        <Button
          variant={isToday ? "default" : "outline"}
          size="sm"
          onClick={() => navigate(todayLA)}
          className="gap-1.5"
        >
          <CalendarDays className="w-4 h-4" />
          Today
        </Button>

        <Button variant="outline" size="sm" onClick={() => navigate(addDays(date, 1))}>
          <ChevronRight className="w-4 h-4" />
        </Button>

        <Input
          type="date"
          value={date}
          onChange={(e) => { if (e.target.value) navigate(e.target.value) }}
          className="w-auto h-9 text-sm cursor-pointer"
        />

        <span className="text-sm font-medium">{formatDayLabel(date)}</span>

        {carriedCount > 0 && (
          <span className="text-xs text-warning font-medium">
            · {carriedCount} job{carriedCount !== 1 ? "s" : ""} carried from previous days
          </span>
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
