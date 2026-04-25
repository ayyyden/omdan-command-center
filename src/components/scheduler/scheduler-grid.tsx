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
import { Bell, Plus, GripVertical, X } from "lucide-react"
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

// ─── Grid constants ───────────────────────────────────────────────────────────
export const PM_LABEL_WIDTH = 160
export const GRID_START_HOUR = 6
export const GRID_END_HOUR = 21
export const HOUR_WIDTH = 96
export const SLOT_WIDTH = 24
export const SLIM_JOB_HEIGHT = 26
export const REMINDER_HEIGHT = 42     // taller blocks for readability
export const JOB_GAP = 3
export const ROW_V_PADDING = 6
export const TIME_HEADER_HEIGHT = 36
export const DRAG_OVERLAY_WIDTH = 180
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
            ? "color-mix(in oklch, var(--primary) 8%, transparent)"
            : isUnassigned
            ? "var(--muted)"
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
        // Fire within 1-minute window of due time (30s poll catches it reliably)
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
    <div
      className="fixed bottom-4 left-4 z-50 flex flex-col gap-2"
      style={{ maxWidth: 300 }}
    >
      {notifications.map((n) => (
        <div
          key={n.id}
          className="bg-card rounded-lg p-3 shadow-xl flex items-start gap-2.5 animate-in slide-in-from-bottom-2"
          style={{
            border: "1px solid color-mix(in oklch, #EAB308 40%, var(--border))",
            borderLeft: "3px solid #EAB308",
          }}
        >
          <Bell className="w-4 h-4 text-warning mt-0.5 shrink-0" style={{ color: "#EAB308" }} />
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

  const [addingReminder, setAddingReminder] = useState(false)
  const [selectedReminder, setSelectedReminder] = useState<SchedulerReminder | null>(null)
  const [reminderTitle, setReminderTitle] = useState("")
  const [reminderType, setReminderType] = useState("custom")
  const [reminderTime, setReminderTime] = useState("")
  const [reminderNotes, setReminderNotes] = useState("")
  const [reminderSubmitting, setReminderSubmitting] = useState(false)

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
  const activeReminderId = isDraggingReminder
    ? activeDragId!.replace("reminder_", "")
    : null

  const pmIdsWithJobs = new Set(
    jobs.map((j) => j.project_manager_id).filter((id): id is string => id !== null)
  )
  const activePmRows = pms.filter((p) => pmIdsWithJobs.has(p.id))
  const hasUnassigned = jobs.some((j) => !j.project_manager_id)
  const pmRows: PmInfo[] = [...activePmRows, ...(hasUnassigned ? [UNASSIGNED_ROW] : [])]

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
    const update: Record<string, string | null> = {
      scheduled_time: newTime,
      project_manager_id: newPmId,
    }
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

  async function handleAddReminder() {
    if (!reminderTitle.trim()) return
    setReminderSubmitting(true)
    const supabase = createClient()
    const { data: inserted, error } = await supabase
      .from("reminders")
      .insert({
        user_id: userId,
        title: reminderTitle.trim(),
        type: reminderType,
        due_date: viewingDate,
        due_time: reminderTime || null,
        notes: reminderNotes.trim() || null,
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
              className="sticky top-0 z-20 flex bg-card"
              style={{ height: TIME_HEADER_HEIGHT, borderBottom: "1px solid var(--border)" }}
            >
              <div
                className="sticky left-0 z-30 bg-card shrink-0 flex items-end pb-1.5 px-3"
                style={{ width: PM_LABEL_WIDTH, borderRight: "1px solid var(--border)" }}
              >
                <span className="text-[11px] text-muted-foreground font-medium">PM / Time →</span>
              </div>
              <div className="relative" style={{ width: TOTAL_GRID_WIDTH, flexShrink: 0 }}>
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="absolute top-0 bottom-0 flex items-end pb-1.5"
                    style={{
                      left: (hour - GRID_START_HOUR) * HOUR_WIDTH,
                      width: HOUR_WIDTH,
                      borderLeft: "1px solid var(--border)",
                    }}
                  >
                    <span className="text-[11px] text-muted-foreground font-medium pl-1.5">
                      {formatHourLabel(hour)}
                    </span>
                  </div>
                ))}
                {nowLineX !== null && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none z-10"
                    style={{ left: nowLineX, width: 2, backgroundColor: "#EF4444", transform: "translateX(-1px)" }}
                  />
                )}
              </div>
            </div>

            {/* ── PM rows ── */}
            {pmRows.length === 0 && (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{ height: 72, borderBottom: "1px solid var(--border)" }}
              >
                No scheduled jobs for this day
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
                  <div
                    className="sticky left-0 z-10 shrink-0 flex flex-col justify-center px-3"
                    style={{
                      width: PM_LABEL_WIDTH,
                      borderRight: "1px solid var(--border)",
                      backgroundColor: isUnassigned ? "var(--muted)" : "var(--card)",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                      <span className="text-sm font-medium truncate text-foreground">{pm.name}</span>
                      {rowJobs.length > 0 && (
                        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">{rowJobs.length}</span>
                      )}
                    </div>
                  </div>

                  <div
                    className="relative"
                    style={{ width: TOTAL_GRID_WIDTH, height: rowH, flexShrink: 0, overflow: "visible" }}
                  >
                    {hours.map((hour) => (
                      <div key={hour} className="absolute top-0 bottom-0"
                        style={{ left: (hour - GRID_START_HOUR) * HOUR_WIDTH, borderLeft: "1px solid var(--border)", opacity: 0.4 }} />
                    ))}
                    {hours.map((hour) => (
                      <div key={`${hour}h`} className="absolute top-0 bottom-0"
                        style={{ left: (hour - GRID_START_HOUR) * HOUR_WIDTH + HOUR_WIDTH / 2, borderLeft: "1px solid var(--border)", opacity: 0.15 }} />
                    ))}
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
                    {nowLineX !== null && (
                      <div
                        className="absolute top-0 bottom-0 pointer-events-none z-10"
                        style={{ left: nowLineX, width: 2, backgroundColor: "#EF4444", transform: "translateX(-1px)" }}
                      />
                    )}
                  </div>
                </PmDroppableRow>
              )
            })}

            {/* ── Reminders header ── */}
            <div
              className="flex items-center gap-2 px-3 bg-muted/60"
              style={{
                height: 28,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
                minWidth: PM_LABEL_WIDTH + TOTAL_GRID_WIDTH,
                position: "sticky",
                left: 0,
              }}
            >
              <Bell className="w-3 h-3 text-muted-foreground shrink-0" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                Reminders
              </span>
              <button
                onClick={() => setAddingReminder(true)}
                className="ml-2 flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              {allDayReminders.length > 0 && (
                <div className="flex items-center gap-1 ml-2 flex-wrap">
                  {allDayReminders.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedReminder(r)}
                      className="text-[10px] px-1.5 py-0.5 rounded-full border transition-colors"
                      style={{
                        backgroundColor: r.completed_at ? "var(--muted)" : "rgba(234,179,8,0.12)",
                        borderColor: r.completed_at ? "var(--border)" : "#EAB308",
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

            {/* ── Reminder timed row ── */}
            <div className="flex" style={{ height: reminderRowH, borderBottom: "1px solid var(--border)" }}>
              <div
                className="sticky left-0 z-10 bg-card shrink-0 flex items-center px-3"
                style={{ width: PM_LABEL_WIDTH, borderRight: "1px solid var(--border)" }}
              >
                <span className="text-[11px] text-muted-foreground">
                  {timedReminders.length === 0 ? "No timed" : `${timedReminders.length} timed`}
                </span>
              </div>
              <div
                className="relative"
                style={{ width: TOTAL_GRID_WIDTH, height: reminderRowH, flexShrink: 0, overflow: "visible" }}
              >
                {hours.map((hour) => (
                  <div key={hour} className="absolute top-0 bottom-0"
                    style={{ left: (hour - GRID_START_HOUR) * HOUR_WIDTH, borderLeft: "1px solid var(--border)", opacity: 0.4 }} />
                ))}
                {hours.map((hour) => (
                  <div key={`${hour}h`} className="absolute top-0 bottom-0"
                    style={{ left: (hour - GRID_START_HOUR) * HOUR_WIDTH + HOUR_WIDTH / 2, borderLeft: "1px solid var(--border)", opacity: 0.15 }} />
                ))}
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
                backgroundColor: "rgba(234,179,8,0.88)",
                borderLeft: "3px solid #EAB308",
                borderRadius: 4,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                paddingLeft: 10,
                paddingRight: 10,
                boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
                cursor: "grabbing",
              }}
            >
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.8)", fontVariantNumeric: "tabular-nums" }}>
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
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 5,
                paddingLeft: 6,
                paddingRight: 8,
                boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
                cursor: "grabbing",
              }}
            >
              <GripVertical style={{ width: 10, height: 10, color: "rgba(255,255,255,0.6)", flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.75)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                {formatTime12(activeJob.scheduled_time)}
              </span>
              <span style={{ fontSize: 11, color: "white", fontWeight: 600, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                {activeJob.customer?.name ?? activeJob.title}
              </span>
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
              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => handleToggleReminder(selectedReminder)}
                >
                  {selectedReminder.completed_at ? "Mark Incomplete" : "Mark Complete"}
                </Button>
                <Button onClick={() => setSelectedReminder(null)}>Close</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

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
                placeholder="Call customer, order materials..."
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
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-notes">Notes</Label>
              <Textarea
                id="r-notes"
                placeholder="Additional details..."
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
