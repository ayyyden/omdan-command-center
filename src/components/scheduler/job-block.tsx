"use client"

import { useDraggable } from "@dnd-kit/core"
import Link from "next/link"
import { GripVertical } from "lucide-react"
import { SLIM_JOB_HEIGHT, JOB_GAP, ROW_V_PADDING, hexToRgba } from "./scheduler-grid"

function formatTime12(time: string | null): string {
  if (!time) return "—"
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

interface SchedulerJob {
  id: string
  title: string
  scheduled_date: string
  scheduled_time: string | null
  status: string
  project_manager_id: string | null
  estimated_duration_minutes: number | null
  customer: { name: string } | null
}

interface JobBlockProps {
  job: SchedulerJob
  xPos: number
  blockWidth: number
  pmColor: string
  isCarried: boolean
  jobIndex: number
}

export function JobBlock({ job, xPos, blockWidth, pmColor, isCarried, jobIndex }: JobBlockProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: job.id })

  return (
    <div
      ref={setNodeRef}
      title={isCarried ? `Carried from ${job.scheduled_date}` : undefined}
      style={{
        position: "absolute",
        left: xPos,
        top: ROW_V_PADDING + jobIndex * (SLIM_JOB_HEIGHT + JOB_GAP),
        width: blockWidth,
        height: SLIM_JOB_HEIGHT,
        backgroundColor: isCarried
          ? hexToRgba("#F59E0B", isDragging ? 0.08 : 0.18)
          : hexToRgba(pmColor, isDragging ? 0.06 : 0.13),
        borderLeft: `3px solid ${isDragging ? "transparent" : isCarried ? "#F59E0B" : pmColor}`,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        zIndex: isDragging ? 0 : 2,
        opacity: isDragging ? 0.3 : 1,
        userSelect: "none",
        transition: "opacity 0.1s",
      }}
      {...attributes}
    >
      <div
        className="flex items-center justify-center h-full shrink-0 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        style={{ width: 18 }}
        {...listeners}
      >
        <GripVertical className="w-2.5 h-2.5" />
      </div>

      <Link
        href={`/jobs/${job.id}`}
        className="flex-1 min-w-0 flex items-center gap-1.5 pr-3 overflow-hidden"
        draggable={false}
        onClick={(e) => { if (isDragging) e.preventDefault() }}
      >
        <span className="text-[9px] text-muted-foreground font-medium tabular-nums shrink-0">
          {formatTime12(job.scheduled_time)}
        </span>
        <span className="text-[11px] font-semibold truncate text-foreground leading-none">
          {job.customer?.name ?? job.title}
        </span>
      </Link>
    </div>
  )
}
