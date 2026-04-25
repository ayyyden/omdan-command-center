"use client"

import { useState, useRef, useEffect } from "react"
import { useDraggable } from "@dnd-kit/core"
import { GripVertical, Check } from "lucide-react"
import {
  REMINDER_HEIGHT,
  JOB_GAP,
  ROW_V_PADDING,
  HOUR_WIDTH,
  SLOT_WIDTH,
  timeToX,
} from "./scheduler-grid"
import type { SchedulerReminder } from "./scheduler-client"

function formatTime12(time: string | null): string {
  if (!time) return "—"
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

const MIN_DURATION = 15  // minimum 15 min

interface ReminderBlockProps {
  reminder: SchedulerReminder
  idx: number
  onToggle: (reminder: SchedulerReminder) => void
  onOpen: (reminder: SchedulerReminder) => void
  onResizeCommit: (reminderId: string, durationMinutes: number) => void
}

export function ReminderBlock({
  reminder,
  idx,
  onToggle,
  onOpen,
  onResizeCommit,
}: ReminderBlockProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `reminder_${reminder.id}`,
  })

  const [localDuration, setLocalDuration] = useState(reminder.duration_minutes)
  const currentDuration = useRef(reminder.duration_minutes)
  const resizeEndTime = useRef(0)
  const [isResizing, setIsResizing] = useState(false)
  const [resizeHover, setResizeHover] = useState(false)

  // Keep local duration in sync when reminder prop changes (e.g. after refresh)
  useEffect(() => {
    if (!isResizing) {
      setLocalDuration(reminder.duration_minutes)
      currentDuration.current = reminder.duration_minutes
    }
  }, [reminder.duration_minutes, isResizing])

  const isCompleted = !!reminder.completed_at
  const xPos = timeToX(reminder.due_time)
  const blockWidth = Math.max(
    MIN_DURATION * (HOUR_WIDTH / 60),
    Math.round(localDuration * (HOUR_WIDTH / 60))
  )

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation()
    e.preventDefault()
    setIsResizing(true)
    const startX = e.clientX
    const startDuration = currentDuration.current

    function onPointerMove(ev: PointerEvent) {
      const deltaX = ev.clientX - startX
      // snap delta to 15-min increments
      const snappedDelta = Math.round(deltaX / SLOT_WIDTH) * SLOT_WIDTH
      const deltaMins = Math.round(snappedDelta / (HOUR_WIDTH / 60) / 15) * 15
      const newDuration = Math.max(MIN_DURATION, startDuration + deltaMins)
      currentDuration.current = newDuration
      setLocalDuration(newDuration)
    }

    function onPointerUp() {
      document.removeEventListener("pointermove", onPointerMove)
      document.removeEventListener("pointerup", onPointerUp)
      setIsResizing(false)
      resizeEndTime.current = Date.now()
      onResizeCommit(reminder.id, currentDuration.current)
    }

    document.addEventListener("pointermove", onPointerMove)
    document.addEventListener("pointerup", onPointerUp)
  }

  function handleBlockClick() {
    // Don't open detail if this was the end of a resize interaction
    if (isDragging || Date.now() - resizeEndTime.current < 200) return
    onOpen(reminder)
  }

  return (
    <div
      ref={setNodeRef}
      style={{
        position: "absolute",
        left: xPos,
        top: ROW_V_PADDING + idx * (REMINDER_HEIGHT + JOB_GAP),
        width: blockWidth,
        height: REMINDER_HEIGHT,
        backgroundColor: isCompleted
          ? "color-mix(in oklch, var(--muted) 80%, transparent)"
          : "rgba(234, 179, 8, 0.13)",
        borderLeft: `3px solid ${isCompleted ? "var(--muted-foreground)" : "#EAB308"}`,
        borderRadius: 4,
        display: "flex",
        alignItems: "center",
        zIndex: isDragging ? 0 : isResizing ? 5 : 2,
        opacity: isDragging ? 0.3 : 1,
        userSelect: "none",
        transition: isResizing ? "none" : "opacity 0.1s",
        cursor: "pointer",
        boxShadow: isResizing ? "0 0 0 2px #EAB308" : undefined,
      }}
      onClick={handleBlockClick}
      {...attributes}
    >
      {/* Drag handle */}
      <div
        className="flex items-center justify-center h-full shrink-0 text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing"
        style={{ width: 16 }}
        onClick={(e) => e.stopPropagation()}
        {...listeners}
      >
        <GripVertical style={{ width: 10, height: 10 }} />
      </div>

      {/* Checkbox */}
      <div
        role="button"
        tabIndex={0}
        className="shrink-0 flex items-center justify-center"
        style={{ width: 16, height: 16, cursor: "pointer" }}
        onClick={(e) => { e.stopPropagation(); onToggle(reminder) }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.stopPropagation()
            onToggle(reminder)
          }
        }}
      >
        <div
          style={{
            width: 13,
            height: 13,
            borderRadius: 3,
            border: `1.5px solid ${isCompleted ? "#EAB308" : "var(--muted-foreground)"}`,
            backgroundColor: isCompleted ? "#EAB308" : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background-color 0.1s, border-color 0.1s",
          }}
        >
          {isCompleted && <Check style={{ width: 8, height: 8, color: "white" }} />}
        </div>
      </div>

      {/* Text content: time + title stacked */}
      <div
        className="flex flex-col justify-center min-w-0 flex-1"
        style={{ paddingLeft: 5, paddingRight: 6, overflow: "hidden" }}
      >
        <span
          style={{
            fontSize: 9,
            fontWeight: 500,
            color: isCompleted ? "var(--muted-foreground)" : "color-mix(in oklch, var(--foreground) 65%, transparent)",
            lineHeight: 1,
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatTime12(reminder.due_time)}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isCompleted ? "var(--muted-foreground)" : "var(--foreground)",
            textDecoration: isCompleted ? "line-through" : "none",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            lineHeight: 1.3,
            marginTop: 2,
          }}
        >
          {reminder.title}
        </span>
      </div>

      {/* Resize handle — right edge */}
      <div
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          width: 10,
          height: "100%",
          cursor: "ew-resize",
          borderRadius: "0 4px 4px 0",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
        }}
        onPointerDown={handleResizePointerDown}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setResizeHover(true)}
        onMouseLeave={() => setResizeHover(false)}
      >
        {[0, 1].map((i) => (
          <div
            key={i}
            style={{
              width: 1.5,
              height: 10,
              borderRadius: 1,
              backgroundColor: isCompleted ? "var(--muted-foreground)" : "#EAB308",
              opacity: resizeHover || isResizing ? 0.9 : 0.3,
              transition: "opacity 0.1s",
            }}
          />
        ))}
      </div>
    </div>
  )
}
