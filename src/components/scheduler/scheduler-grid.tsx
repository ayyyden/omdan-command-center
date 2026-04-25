"use client"

import { useState, useEffect, useRef } from "react"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core"
import type { DragEndEvent, DragStartEvent, Modifier } from "@dnd-kit/core"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { upsertJobReminders } from "@/lib/reminders"
import { useToast } from "@/hooks/use-toast"
import { JobBlock } from "./job-block"
import { ReminderBlock } from "./reminder-block"
import type { SchedulerJob, PmInfo, SchedulerReminder } from "./scheduler-client"
import { Bell, Plus, GripVertical, X, Trash2, CalendarDays } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

// ─── Grid constants ───────────────────────────────────────────────────────────
export const PM_LABEL_WIDTH = 180
export const GRID_START_HOUR = 6
export const GRID_END_HOUR = 21
export const HOUR_WIDTH = 120
export const SLOT_WIDTH = 30        // HOUR_WIDTH / 4 → one 15-min slot = 30px
export const SLIM_JOB_HEIGHT = 38
export const REMINDER_HEIGHT = 46
export const JOB_GAP = 4
export const ROW_V_PADDING = 8
export const TIME_HEADER_HEIGHT = 44
export const DRAG_OVERLAY_WIDTH = 220
const TOTAL_HOURS = GRID_END_HOUR - GRID_START_HOUR
const TOTAL_GRID_WIDTH = TOTAL_HOURS * HOUR_WIDTH

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function timeToX(time: string | null): number {
  if (!time) return 0
  const [h, m] = time.split(":").map(Number)
  const minutesFromStart = h * 60 + m - GRID_START_HOUR * 60
  return Math.max(0, minutesFromStart * (HOUR_WIDTH / 60))
}

export function xToTime(x: number): string {
  const clamped = Math.max(0, Math.min(TOTAL_GRID_WIDTH - SLOT_WIDTH, x))
  const slots = Math.round(clamped / SLOT_WIDTH)
  const totalMinutes = GRID_START_HOUR * 60 + slots * 15
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function calcRowHeight(count: number): number {
  const n = Math.max(1, count)
  return ROW_V_PADDING * 2 + n * SLIM_JOB_HEIGHT + (n - 1) * JOB_GAP
}

function calcReminderRowHeight(count: number): number {
  const n = Math.max(1, count)
  return ROW_V_PADDING * 2 + n * REMINDER_HEIGHT + (n - 1) * JOB_GAP
}

function getNowX(viewingDate: string): number | null {
  const now = new Date()
  const laDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now)
  if (laDate !== viewingDate) return null
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", hour12: false,
  }).formatToParts(now)
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10)
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10)
  const minutesFromStart = h * 60 + m - GRID_START_HOUR * 60
  if (minutesFromStart < 0 || minutesFromStart >= TOTAL_HOURS * 60) return null
  return minutesFromStart * (HOUR_WIDTH / 60)
}

function formatHourLabel(hour: number): string {
  if (hour === 12) return "12 PM"
  if (hour < 12) return `${hour} AM`
  return `${hour - 12} PM`
}

function formatTime12(time: string | null): string {
  if (!time) return "—"
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function formatReminderType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

const snapToGridX: Modifier = ({ transform }) => ({
  ...transform,
  x: Math.round(transform.x / SLOT_WIDTH) * SLOT_WIDTH,
})

const UNASSIGNED_ROW: PmInfo = { id: "unassigned", name: "Unassigned", color: "#6B7280" }

// ─── Now line ─────────────────────────────────────────────────────────────────
function NowLine({ x }: { x: number }) {
  return (
    <div
      className="absolute top-0 bottom-0 pointer-events-none z-10"
      style={{ left: x }}
    >
      <div
        style={{
          position: "absolute",
          top: -4,
          left: "50%",
          transform: "translateX(-50%)",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "#EF4444",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 4,
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: 2,
          backgroundColor: "#EF4444",
          boxShadow: "0 0 6px rgba(239,68,68,0.35)",
        }}
      />
    </div>
  )
}

// ─── Grid columns (hour lines) ────────────────────────────────────────────────
function GridColumns({ hours }: { hours: number[] }) {
  return (
    <>
      {hours.map((hour) => (
        <div
          key={hour}
          className="absolute top-0 bottom-0"
          style={{
            left: (hour - GRID_START_HOUR) * HOUR_WIDTH,
            borderLeft: "1px solid var(--border)",
            opacity: 0.35,
          }}
        />
      ))}
      {hours.map((hour) => (
        <div
          key={`${hour}h`}
          className="absolute top-0 bottom-0"
          style={{
            left: (hour - GRID_START_HOUR) * HOUR_WIDTH + HOUR_WIDTH / 2,
            borderLeft: "1px solid var(--border)",
            opacity: 0.12,
          }}
        />
      ))}
    </>
  )
}

// ─── Droppable PM row ─────────────────────────────────────────────────────────
function PmDroppableRow({
  pmId,
  rowH,
  isActiveDrag,
  isUnassigned,
  children,
}: {
  pmId: string
  rowH: number
  isActiveDrag: boolean
  isUnassigned: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: pmId })
  return (
    <div
      ref={setNodeRef}
      className="flex"
      style={{
        height: rowH,
        borderBottom: "1px solid var(--border)",
        backgroundColor:
          isOver && isActiveDrag
            ? "color-mix(in oklch, var(--primary) 7%, transparent)"
            : isUnassigned
            ? "color-mix(in oklch, var(--muted) 60%, transparent)"
            : undefined,
        transition: "background-color 0.1s",
      }}
    >
      {children}
    </div>
  )
}

// ─── Reminder notification popup ─────────────────────────────────────────────
function ReminderNotifier({ reminders }: { reminders: SchedulerReminder[] }) {
  const [notifications, setNotifications] = useState<SchedulerReminder[]>([])
  const firedIds = useRef(new Set<string>())

  useEffect(() => {
    function checkReminders() {
      const now = new Date()
      const nowMins = now.getHours() * 60 + now.getMinutes()
      reminders.forEach((reminder) => {
        if (!reminder.due_time || reminder.completed_at || firedIds.current.has(reminder.id)) return
        const [dh, dm] = reminder.due_time.split(":").map(Number)
        const dueMins = dh * 60 + dm
        if (nowMins >= dueMins && nowMins <= dueMins + 1) {
          firedIds.current.add(reminder.id)
          setNotifications((prev) => [...prev, reminder])
        }
      })
    }
    checkReminders()
    const interval = setInterval(checkReminders, 30_000)
    return () => clearInterval(interval)
  }, [reminders])

  if (notifications.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2" style={{ maxWidth: 300 }}>
      {notifications.map((n) => (
        <div
          key={n.id}
          className="bg-card rounded-xl p-3 shadow-xl flex items-start gap-2.5 animate-in slide-in-from-bottom-2"
          style={{
            border: "1px solid color-mix(in oklch, #EAB308 40%, var(--border))",
            borderLeft: "3px solid #EAB308",
          }}
        >
          <Bell className="w-4 h-4 mt-0.5 shrink-0" style={{ color: "#EAB308" }} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-tight">{n.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{formatTime12(n.due_time)}</p>
          </div>
          <button
            onClick={() => setNotifications((prev) => prev.filter((x) => x.id !== n.id))}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0 mt-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────────────────────
interface SchedulerGridProps {
  jobs: SchedulerJob[]
  pms: PmInfo[]
  reminders: SchedulerReminder[]
  viewingDate: string
  userId: string
}

export function SchedulerGrid({
  jobs: initialJobs,
  pms,
  reminders: initialReminders,
  viewingDate,
  userId,
}: SchedulerGridProps) {
  const [jobs, setJobs] = useState(initialJobs)
  const [reminders, setReminders] = useState(initialReminders)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)

  // Reminder add form state
  const [addingReminder, setAddingReminder] = useState(false)
  const [reminderTitle, setReminderTitle] = useState("")
  const [reminderType, setReminderType] = useState("custom")
  const [reminderTime, setReminderTime] = useState("")
  const [reminderNotes, setReminderNotes] = useState("")
  const [reminderSubmitting, setReminderSubmitting] = useState(false)

  // Reminder detail/delete state
  const [selectedReminder, setSelectedReminder] = useState<SchedulerReminder | null>(null)
  const [deletingReminderId, setDeletingReminderId] = useState<string | null>(null)
  const [deletingLoading, setDeletingLoading] = useState(false)

  const router = useRouter()
  const { toast } = useToast()

  const [nowLineX, setNowLineX] = useState<number | null>(() => getNowX(viewingDate))

  useEffect(() => { setJobs(initialJobs) }, [initialJobs])
  useEffect(() => { setReminders(initialReminders) }, [initialReminders])
  useEffect(() => {
    setNowLineX(getNowX(viewingDate))
    const interval = setInterval(() => setNowLineX(getNowX(viewingDate)), 60_000)
    return () => clearInterval(interval)
  }, [viewingDate])

  const isDraggingReminder = activeDragId?.startsWith("reminder_") ?? false
  const activeJobId = !isDraggingReminder ? activeDragId : null
  const activeReminderId = isDraggingReminder ? activeDragId!.replace("reminder_", "") : null

  // Show all active PMs at all times so you can see which PMs are free vs busy
  const hasUnassigned = jobs.some((j) => !j.project_manager_id)
  const pmRows: PmInfo[] = [...pms, ...(hasUnassigned ? [UNASSIGNED_ROW] : [])]

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  function handleDragStart({ active }: DragStartEvent) {
    setActiveDragId(active.id as string)
  }

  async function handleDragEnd({ active, delta, over }: DragEndEvent) {
    const activeId = active.id as string
    setActiveDragId(null)

    // ── Reminder drag: only X (time) ──
    if (activeId.startsWith("reminder_")) {
      const reminderId = activeId.replace("reminder_", "")
      const reminder = reminders.find((r) => r.id === reminderId)
      if (!reminder?.due_time) return

      const snappedDeltaX = Math.round(delta.x / SLOT_WIDTH) * SLOT_WIDTH
      if (snappedDeltaX === 0) return

      const newTime = xToTime(timeToX(reminder.due_time) + snappedDeltaX)
      setReminders((prev) =>
        prev.map((r) => (r.id === reminderId ? { ...r, due_time: newTime } : r))
      )
      const supabase = createClient()
      const { error } = await supabase
        .from("reminders")
        .update({ due_time: newTime })
        .eq("id", reminderId)
      if (error) {
        toast({ title: "Error updating reminder", description: error.message, variant: "destructive" })
        setReminders(initialReminders)
      }
      return
    }

    // ── Job drag: X = time, over.id = PM row ──
    const job = jobs.find((j) => j.id === activeId)
    if (!job) return

    const snappedDeltaX = Math.round(delta.x / SLOT_WIDTH) * SLOT_WIDTH
    const newTime = xToTime(timeToX(job.scheduled_time) + snappedDeltaX)

    const targetRowId = over?.id as string | undefined
    const newPmId =
      targetRowId === undefined
        ? job.project_manager_id
        : targetRowId === "unassigned"
        ? null
        : targetRowId

    if (newTime === job.scheduled_time && newPmId === job.project_manager_id) return

    const isCarried = job.scheduled_date < viewingDate
    const newDate = isCarried ? viewingDate : job.scheduled_date

    setJobs((prev) =>
      prev.map((j) =>
        j.id === job.id
          ? { ...j, scheduled_time: newTime, project_manager_id: newPmId, scheduled_date: newDate }
          : j
      )
    )
    const supabase = createClient()
    const update: Record<string, string | null> = { scheduled_time: newTime, project_manager_id: newPmId }
    if (isCarried) update.scheduled_date = newDate
    const { error } = await supabase.from("jobs").update(update).eq("id", job.id)
    if (error) {
      toast({ title: "Error updating schedule", description: error.message, variant: "destructive" })
      setJobs(initialJobs)
      return
    }
    await upsertJobReminders(supabase, {
      userId,
      jobId:         job.id,
      customerId:    job.customer_id,
      customerName:  job.customer?.name ?? "",
      scheduledDate: newDate,
      scheduledTime: newTime,
    })
    router.refresh()
  }

  async function handleToggleReminder(reminder: SchedulerReminder) {
    const completed_at = reminder.completed_at ? null : new Date().toISOString()
    setReminders((prev) =>
      prev.map((r) => (r.id === reminder.id ? { ...r, completed_at } : r))
    )
    setSelectedReminder((prev) =>
      prev?.id === reminder.id ? { ...prev, completed_at } : prev
    )
    const supabase = createClient()
    const { error } = await supabase
      .from("reminders")
      .update({ completed_at })
      .eq("id", reminder.id)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      setReminders(initialReminders)
    }
  }

  async function handleResizeCommit(reminderId: string, durationMinutes: number) {
    setReminders((prev) =>
      prev.map((r) => (r.id === reminderId ? { ...r, duration_minutes: durationMinutes } : r))
    )
    const supabase = createClient()
    const { error } = await supabase
      .from("reminders")
      .update({ duration_minutes: durationMinutes })
      .eq("id", reminderId)
    if (error) {
      toast({ title: "Error updating reminder", description: error.message, variant: "destructive" })
      setReminders(initialReminders)
    }
  }

  async function handleDeleteReminder(reminderId: string) {
    setDeletingLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("reminders").delete().eq("id", reminderId)
    setDeletingLoading(false)
    setDeletingReminderId(null)
    if (error) {
      toast({ title: "Error deleting reminder", description: error.message, variant: "destructive" })
      return
    }
    setReminders((prev) => prev.filter((r) => r.id !== reminderId))
    if (selectedReminder?.id === reminderId) setSelectedReminder(null)
  }

  async function handleAddReminder() {
    if (!reminderTitle.trim()) return
    setReminderSubmitting(true)
    const supabase = createClient()
    const { data: inserted, error } = await supabase
      .from("reminders")
      .insert({
        user_id:  userId,
        title:    reminderTitle.trim(),
        type:     reminderType,
        due_date: viewingDate,
        due_time: reminderTime || null,
        notes:    reminderNotes.trim() || null,
      })
      .select("id, title, due_date, due_time, type, completed_at, notes, duration_minutes")
      .single()

    setReminderSubmitting(false)
    if (error) {
      toast({ title: "Error adding reminder", description: error.message, variant: "destructive" })
      return
    }
    setReminders((prev) => [...prev, inserted as SchedulerReminder])
    setAddingReminder(false)
    setReminderTitle("")
    setReminderType("custom")
    setReminderTime("")
    setReminderNotes("")
    router.refresh()
  }

  const activeJob = activeJobId ? (jobs.find((j) => j.id === activeJobId) ?? null) : null
  const activeReminderDrag = activeReminderId
    ? (reminders.find((r) => r.id === activeReminderId) ?? null)
    : null
  const activePmColor = activeJob?.project_manager_id
    ? (pms.find((p) => p.id === activeJob.project_manager_id)?.color ?? "#6B7280")
    : "#6B7280"

  const hours = Array.from({ length: TOTAL_HOURS }, (_, i) => GRID_START_HOUR + i)
  const timedReminders = reminders.filter((r) => r.due_time)
  const allDayReminders = reminders.filter((r) => !r.due_time)
  const reminderRowH = calcReminderRowHeight(timedReminders.length || 1)

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="overflow-auto flex-1 bg-background">
          <div style={{ minWidth: PM_LABEL_WIDTH + TOTAL_GRID_WIDTH }}>

            {/* ── Time header ── */}
            <div
              className="sticky top-0 z-20 flex bg-card/95 backdrop-blur-sm"
              style={{ height: TIME_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}
            >
              {/* PM column header */}
              <div
                className="sticky left-0 z-30 bg-card/95 backdrop-blur-sm shrink-0 flex items-center px-4"
                style={{ width: PM_LABEL_WIDTH, borderRight: "1px solid var(--border)" }}
              >
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Team
                </span>
              </div>

              {/* Hour labels */}
              <div className="relative" style={{ width: TOTAL_GRID_WIDTH, flexShrink: 0 }}>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute inset-y-0 flex items-end pb-2"
                    style={{
                      left: (hour - GRID_START_HOUR) * HOUR_WIDTH,
                      width: HOUR_WIDTH,
                    }}
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0"
                      style={{ borderLeft: "1px solid var(--border)", opacity: 0.4 }}
                    />
                    <span className="text-[11px] font-medium text-muted-foreground pl-2 select-none">
                      {formatHourLabel(hour)}
                    </span>
                  </div>
                ))}
                {/* 30-min ticks at bottom edge */}
                {hours.map((hour) => (
                  <div
                    key={`${hour}h`}
                    className="absolute bottom-0"
                    style={{
                      left: (hour - GRID_START_HOUR) * HOUR_WIDTH + HOUR_WIDTH / 2,
                      height: 6,
                      borderLeft: "1px solid var(--border)",
                      opacity: 0.2,
                    }}
                  />
                ))}
                {nowLineX !== null && <NowLine x={nowLineX} />}
              </div>
            </div>

            {/* ── PM rows ── */}
            {pmRows.length === 0 && (
              <div
                className="flex flex-col items-center justify-center gap-2 text-muted-foreground"
                style={{ height: 120, borderBottom: "1px solid var(--border)" }}
              >
                <CalendarDays className="w-8 h-8 opacity-20" />
                <div className="text-center">
                  <p className="text-sm font-medium">No jobs scheduled</p>
                  <p className="text-xs opacity-60 mt-0.5">Jobs will appear here once scheduled</p>
                </div>
              </div>
            )}

            {pmRows.map((pm) => {
              const rowJobs = jobs
                .filter((j) =>
                  pm.id === "unassigned" ? !j.project_manager_id : j.project_manager_id === pm.id
                )
                .sort((a, b) => (a.scheduled_time ?? "").localeCompare(b.scheduled_time ?? ""))
              const isUnassigned = pm.id === "unassigned"
              const rowH = calcRowHeight(rowJobs.length)

              return (
                <PmDroppableRow
                  key={pm.id}
                  pmId={pm.id}
                  rowH={rowH}
                  isActiveDrag={activeJobId !== null}
                  isUnassigned={isUnassigned}
                >
                  {/* PM label */}
                  <div
                    className="sticky left-0 z-10 shrink-0 flex items-center gap-3 px-4"
                    style={{
                      width: PM_LABEL_WIDTH,
                      height: rowH,
                      borderRight: "1px solid var(--border)",
                      backgroundColor: isUnassigned ? "var(--muted)" : "var(--card)",
                    }}
                  >
                    <div
                      className="shrink-0 rounded-full ring-2 ring-offset-1 ring-offset-card"
                      style={{
                        width: 10,
                        height: 10,
                        backgroundColor: pm.color,
                        boxShadow: `0 0 0 2px ${pm.color}33`,
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-foreground truncate block leading-tight">
                        {pm.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground leading-tight">
                        {rowJobs.length === 0
                          ? "Free today"
                          : `${rowJobs.length} job${rowJobs.length > 1 ? "s" : ""}`}
                      </span>
                    </div>
                  </div>

                  {/* Job cells */}
                  <div
                    className="relative"
                    style={{ width: TOTAL_GRID_WIDTH, height: rowH, flexShrink: 0, overflow: "visible" }}
                  >
                    <GridColumns hours={hours} />

                    {rowJobs.length === 0 && (
                      <div className="absolute inset-0 flex items-center pl-4">
                        <span className="text-xs text-muted-foreground/25 select-none italic">
                          No jobs — drag here to assign
                        </span>
                      </div>
                    )}

                    {rowJobs.map((job, idx) => {
                      const xPos = timeToX(job.scheduled_time)
                      const durationMins = job.estimated_duration_minutes ?? 120
                      const blockWidth = Math.min(
                        Math.max(SLOT_WIDTH * 2, Math.round(durationMins * (HOUR_WIDTH / 60))),
                        TOTAL_GRID_WIDTH - xPos,
                      )
                      return (
                        <JobBlock
                          key={job.id}
                          job={job}
                          xPos={xPos}
                          blockWidth={blockWidth}
                          pmColor={pm.color}
                          isCarried={job.scheduled_date < viewingDate}
                          jobIndex={idx}
                        />
                      )
                    })}

                    {nowLineX !== null && <NowLine x={nowLineX} />}
                  </div>
                </PmDroppableRow>
              )
            })}

            {/* ── Reminders section header ── */}
            <div
              className="flex items-center gap-2 px-4 bg-muted/50"
              style={{
                height: 32,
                borderTop: "2px solid var(--border)",
                borderBottom: "1px solid var(--border)",
                minWidth: PM_LABEL_WIDTH + TOTAL_GRID_WIDTH,
                position: "sticky",
                left: 0,
              }}
            >
              <Bell className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Reminders
              </span>
              {reminders.length > 0 && (
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "rgba(234,179,8,0.15)",
                    color: "#B45309",
                  }}
                >
                  {reminders.length}
                </span>
              )}
              <button
                onClick={() => setAddingReminder(true)}
                className="flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors ml-1"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>

              {/* All-day reminder chips */}
              {allDayReminders.length > 0 && (
                <div className="flex items-center gap-1.5 ml-2 flex-wrap">
                  {allDayReminders.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedReminder(r)}
                      className="text-[10px] px-2 py-0.5 rounded-full border transition-all hover:opacity-80"
                      style={{
                        backgroundColor: r.completed_at ? "var(--muted)" : "rgba(234,179,8,0.1)",
                        borderColor: r.completed_at ? "var(--border)" : "rgba(234,179,8,0.6)",
                        color: r.completed_at ? "var(--muted-foreground)" : "var(--foreground)",
                        textDecoration: r.completed_at ? "line-through" : "none",
                      }}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── Timed reminders row ── */}
            <div className="flex" style={{ height: reminderRowH, borderBottom: "1px solid var(--border)" }}>
              <div
                className="sticky left-0 z-10 bg-card shrink-0 flex flex-col items-start justify-center px-4 gap-0.5"
                style={{ width: PM_LABEL_WIDTH, borderRight: "1px solid var(--border)" }}
              >
                <span className="text-[11px] font-semibold text-muted-foreground">
                  {timedReminders.length === 0 ? "No timed" : `${timedReminders.length} timed`}
                </span>
                {timedReminders.length > 0 && (
                  <span className="text-[10px] text-muted-foreground/60">
                    drag to reschedule
                  </span>
                )}
              </div>
              <div
                className="relative"
                style={{ width: TOTAL_GRID_WIDTH, height: reminderRowH, flexShrink: 0, overflow: "visible" }}
              >
                <GridColumns hours={hours} />
                {timedReminders.length === 0 && (
                  <div className="absolute inset-0 flex items-center pl-4">
                    <span className="text-xs text-muted-foreground/25 select-none italic">
                      No timed reminders — add one above
                    </span>
                  </div>
                )}
                {timedReminders.map((r, idx) => (
                  <ReminderBlock
                    key={r.id}
                    reminder={r}
                    idx={idx}
                    onToggle={handleToggleReminder}
                    onOpen={setSelectedReminder}
                    onResizeCommit={handleResizeCommit}
                  />
                ))}
              </div>
            </div>

          </div>
        </div>

        {/* ── Drag overlay ── */}
        <DragOverlay modifiers={[snapToGridX]} dropAnimation={null}>
          {activeReminderDrag ? (
            <div
              style={{
                width: Math.round(activeReminderDrag.duration_minutes * (HOUR_WIDTH / 60)),
                height: REMINDER_HEIGHT,
                backgroundColor: "rgba(234,179,8,0.9)",
                borderLeft: "3px solid #EAB308",
                borderRadius: 6,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                paddingLeft: 10,
                paddingRight: 10,
                boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                cursor: "grabbing",
              }}
            >
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.85)", fontVariantNumeric: "tabular-nums" }}>
                {formatTime12(activeReminderDrag.due_time)}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: "white", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", marginTop: 2 }}>
                {activeReminderDrag.title}
              </span>
            </div>
          ) : activeJob ? (
            <div
              style={{
                width: DRAG_OVERLAY_WIDTH,
                height: SLIM_JOB_HEIGHT,
                backgroundColor: hexToRgba(activePmColor, 0.92),
                borderLeft: `3px solid ${activePmColor}`,
                borderRadius: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
                paddingLeft: 8,
                paddingRight: 10,
                boxShadow: "0 6px 20px rgba(0,0,0,0.25)",
                cursor: "grabbing",
              }}
            >
              <GripVertical style={{ width: 10, height: 10, color: "rgba(255,255,255,0.5)", flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 11, color: "white", fontWeight: 600, display: "block", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                  {activeJob.customer?.name ?? activeJob.title}
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.7)", fontVariantNumeric: "tabular-nums" }}>
                  {formatTime12(activeJob.scheduled_time)}
                </span>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* ── Reminder detail dialog ── */}
      <Dialog open={selectedReminder !== null} onOpenChange={(open) => !open && setSelectedReminder(null)}>
        <DialogContent className="sm:max-w-sm">
          {selectedReminder && (
            <>
              <DialogHeader>
                <DialogTitle className={selectedReminder.completed_at ? "line-through text-muted-foreground" : ""}>
                  {selectedReminder.title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 py-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground w-14 shrink-0">Type</span>
                  <Badge variant="secondary" className="text-xs">
                    {formatReminderType(selectedReminder.type)}
                  </Badge>
                </div>
                {selectedReminder.due_time && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground w-14 shrink-0">Time</span>
                    <span>{formatTime12(selectedReminder.due_time)}</span>
                    <span className="text-muted-foreground text-xs">({selectedReminder.duration_minutes} min)</span>
                  </div>
                )}
                {selectedReminder.notes && (
                  <>
                    <Separator />
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{selectedReminder.notes}</p>
                  </>
                )}
                {selectedReminder.completed_at && (
                  <p className="text-xs text-green-600 font-medium">
                    Completed {new Date(selectedReminder.completed_at).toLocaleString()}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeletingReminderId(selectedReminder.id)}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  Delete
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleToggleReminder(selectedReminder)}
                  >
                    {selectedReminder.completed_at ? "Mark Incomplete" : "Mark Complete"}
                  </Button>
                  <Button size="sm" onClick={() => setSelectedReminder(null)}>Close</Button>
                </div>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Reminder delete confirmation ── */}
      <ConfirmDialog
        open={deletingReminderId !== null}
        onOpenChange={(open) => { if (!open) setDeletingReminderId(null) }}
        title="Delete reminder?"
        description="This will permanently delete this reminder. This cannot be undone. Linked jobs and estimates are not affected."
        confirmLabel="Delete"
        onConfirm={() => { if (deletingReminderId) handleDeleteReminder(deletingReminderId) }}
        loading={deletingLoading}
      />

      {/* ── Add reminder dialog ── */}
      <Dialog open={addingReminder} onOpenChange={setAddingReminder}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Reminder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="r-title">Title *</Label>
              <Input
                id="r-title"
                placeholder="Call customer, order materials…"
                value={reminderTitle}
                onChange={(e) => setReminderTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddReminder() }}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="r-type">Type</Label>
                <Select value={reminderType} onValueChange={setReminderType}>
                  <SelectTrigger id="r-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom</SelectItem>
                    <SelectItem value="estimate_follow_up">Estimate Follow-up</SelectItem>
                    <SelectItem value="payment_reminder">Payment Reminder</SelectItem>
                    <SelectItem value="material_reminder">Material Reminder</SelectItem>
                    <SelectItem value="review_request">Review Request</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="r-time">Time (optional)</Label>
                <Input
                  id="r-time"
                  type="time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="dark:[color-scheme:dark]"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-notes">Notes</Label>
              <Textarea
                id="r-notes"
                placeholder="Additional details…"
                className="min-h-[60px]"
                value={reminderNotes}
                onChange={(e) => setReminderNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingReminder(false)}>Cancel</Button>
            <Button onClick={handleAddReminder} disabled={!reminderTitle.trim() || reminderSubmitting}>
              Add Reminder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Time-based reminder notifications ── */}
      <ReminderNotifier reminders={reminders} />
    </>
  )
}
