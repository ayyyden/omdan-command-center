"use client"

import { useDraggable } from "@dnd-kit/core"
import Link from "next/link"
import { GripVertical } from "lucide-react"
import { SLIM_JOB_HEIGHT, JOB_GAP, ROW_V_PADDING, hexToRgba } from "./scheduler-grid"

function formatTime12(time: string | null): string {
  if (!time) return ""
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
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

  // Hide subtitle row on narrow blocks to avoid overflow
  const isNarrow = blockWidth < 72
  const borderColor = isDragging ? "transparent" : isCarried ? "#F59E0B" : pmColor
  const bgColor = isCarried
    ? hexToRgba("#F59E0B", isDragging ? 0.06 : 0.14)
    : hexToRgba(pmColor, isDragging ? 0.05 : 0.12)

  const timeLabel = formatTime12(job.scheduled_time)
  const durationLabel = job.estimated_duration_minutes
    ? formatDuration(job.estimated_duration_minutes)
    : null
  const subtitle = [timeLabel, durationLabel].filter(Boolean).join(" · ")

  return (
    <div
      ref={setNodeRef}
      title={
        isCarried
          ? `Carried from ${job.scheduled_date} — ${job.customer?.name ?? job.title}`
          : job.customer?.name ?? job.title
      }
      style={{
        position: "absolute",
        left: xPos,
        top: ROW_V_PADDING + jobIndex * (SLIM_JOB_HEIGHT + JOB_GAP),
        width: blockWidth,
        height: SLIM_JOB_HEIGHT,
        backgroundColor: bgColor,
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: 6,
        display: "flex",
        alignItems: "stretch",
        zIndex: isDragging ? 0 : 2,
        opacity: isDragging ? 0.25 : 1,
        userSelect: "none",
        transition: "opacity 0.12s",
        overflow: "hidden",
      }}
      {...attributes}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-center shrink-0 text-muted-foreground/40 hover:text-muted-foreground/80 cursor-grab active:cursor-grabbing transition-colors"
        style={{ width: 16 }}
        {...listeners}
      >
        <GripVertical className="w-2.5 h-2.5" />
      </div>

      {/* Job content: customer name + time/duration subtitle */}
      <Link
        href={`/jobs/${job.id}`}
        className="flex-1 min-w-0 flex flex-col justify-center pr-2 overflow-hidden"
        draggable={false}
        onClick={(e) => { if (isDragging) e.preventDefault() }}
      >
        <span
          className="font-semibold truncate leading-tight text-foreground"
          style={{ fontSize: isNarrow ? 9 : 11 }}
        >
          {job.customer?.name ?? job.title}
        </span>
        {!isNarrow && subtitle && (
          <span
            className="truncate leading-tight"
            style={{
              fontSize: 9,
              color: isCarried ? "rgba(180,83,9,0.8)" : "var(--muted-foreground)",
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {subtitle}
            {isCarried && " · carried"}
          </span>
        )}
      </Link>
    </div>
  )
}
