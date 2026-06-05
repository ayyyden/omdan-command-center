"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { CalendarDays, Clock, Pencil, Plus, UserCircle, X, Check, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Appt {
  id: string
  scheduled_date: string
  start_time: string | null
  end_time: string | null
  status: string
  project_summary: string | null
  assigned_pm_id: string | null
  assigned_pm: { id: string; name: string; color: string } | null
}

interface PmOption { id: string; name: string; color: string }

interface AppointmentCardProps {
  appointments: Appt[]
  pms: PmOption[]
  customerId: string
  projectSummary?: string | null
}

const STATUS_LABELS: Record<string, string> = {
  scheduled:       "Scheduled",
  visited:         "Visited",
  estimate_needed: "Estimate Needed",
  estimate_sent:   "Estimate Sent",
  no_show:         "No Show",
  cancelled:       "Cancelled",
  converted:       "Converted",
}
const STATUS_COLORS: Record<string, string> = {
  scheduled:       "bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300",
  visited:         "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300",
  estimate_needed: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  estimate_sent:   "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  no_show:         "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  cancelled:       "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  converted:       "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })
}

function formatTime(t: string | null) {
  if (!t) return ""
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

interface EditState {
  scheduled_date: string
  start_time: string
  end_time: string
  assigned_pm_id: string
  status: string
}

export function AppointmentCard({ appointments, pms, customerId, projectSummary }: AppointmentCardProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editState, setEditState] = useState<EditState | null>(null)
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newAppt, setNewAppt] = useState({ scheduled_date: "", start_time: "", end_time: "", assigned_pm_id: "" })
  const [addSaving, setAddSaving] = useState(false)

  function startEdit(appt: Appt) {
    setEditingId(appt.id)
    setEditState({
      scheduled_date: appt.scheduled_date,
      start_time:     appt.start_time  ?? "",
      end_time:       appt.end_time    ?? "",
      assigned_pm_id: appt.assigned_pm_id ?? "none",
      status:         appt.status,
    })
  }

  async function saveEdit(apptId: string) {
    if (!editState) return
    setSaving(true)
    try {
      const res = await fetch(`/api/lead-appointments/${apptId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduled_date:  editState.scheduled_date || null,
          start_time:      editState.start_time     || null,
          end_time:        editState.end_time        || null,
          assigned_pm_id:  editState.assigned_pm_id === "none" ? null : editState.assigned_pm_id || null,
          status:          editState.status,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error saving", description: d.error, variant: "destructive" })
        return
      }
      setEditingId(null)
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleAddAppointment() {
    if (!newAppt.scheduled_date) return
    setAddSaving(true)
    try {
      const res = await fetch("/api/lead-appointments", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_id:     customerId,
          scheduled_date:  newAppt.scheduled_date,
          start_time:      newAppt.start_time      || null,
          end_time:        newAppt.end_time         || null,
          assigned_pm_id:  newAppt.assigned_pm_id  || null,
          project_summary: projectSummary           ?? null,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toast({ title: "Error adding appointment", description: d.error, variant: "destructive" })
        return
      }
      setAdding(false)
      setNewAppt({ scheduled_date: "", start_time: "", end_time: "", assigned_pm_id: "" })
      router.refresh()
    } finally {
      setAddSaving(false)
    }
  }

  const STATUSES = ["scheduled","visited","estimate_needed","estimate_sent","no_show","cancelled","converted"] as const

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            Appointments
          </CardTitle>
          {!adding && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => setAdding(true)}>
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Add new appointment form */}
        {adding && (
          <div className="rounded-lg border border-dashed p-3 space-y-3 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">New Appointment</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div className="col-span-2 sm:col-span-1">
                <label className="text-xs text-muted-foreground mb-1 block">Date *</label>
                <Input type="date" value={newAppt.scheduled_date} onChange={(e) => setNewAppt(p => ({ ...p, scheduled_date: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Start Time</label>
                <Input type="time" value={newAppt.start_time} onChange={(e) => setNewAppt(p => ({ ...p, start_time: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" disabled={!newAppt.scheduled_date} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">End Time</label>
                <Input type="time" value={newAppt.end_time} onChange={(e) => setNewAppt(p => ({ ...p, end_time: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" disabled={!newAppt.scheduled_date} />
              </div>
            </div>
            {pms.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Assign PM</label>
                <Select value={newAppt.assigned_pm_id} onValueChange={(v) => setNewAppt(p => ({ ...p, assigned_pm_id: v }))}>
                  <SelectTrigger className="h-8 text-sm w-full sm:w-52">
                    <SelectValue placeholder="No PM assigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No PM assigned</SelectItem>
                    {pms.map((pm) => (
                      <SelectItem key={pm.id} value={pm.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                          {pm.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={addSaving || !newAppt.scheduled_date} onClick={handleAddAppointment}>
                {addSaving && <Loader2 className="w-3 h-3 mr-1 animate-spin" />} Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAdding(false); setNewAppt({ scheduled_date: "", start_time: "", end_time: "", assigned_pm_id: "" }) }}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Appointment list */}
        {appointments.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground py-1">No appointments scheduled.</p>
        )}

        {appointments.map((appt) => {
          const isEditing = editingId === appt.id
          const pm = appt.assigned_pm

          if (isEditing && editState) {
            return (
              <div key={appt.id} className="rounded-lg border p-3 space-y-3 bg-muted/20">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="text-xs text-muted-foreground mb-1 block">Date *</label>
                    <Input type="date" value={editState.scheduled_date} onChange={(e) => setEditState(s => s && ({ ...s, scheduled_date: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Start Time</label>
                    <Input type="time" value={editState.start_time} onChange={(e) => setEditState(s => s && ({ ...s, start_time: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">End Time</label>
                    <Input type="time" value={editState.end_time} onChange={(e) => setEditState(s => s && ({ ...s, end_time: e.target.value }))} className="h-8 text-sm dark:[color-scheme:dark]" />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pms.length > 0 && (
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1 block"><UserCircle className="w-3 h-3" /> PM</label>
                      <Select value={editState.assigned_pm_id} onValueChange={(v) => setEditState(s => s && ({ ...s, assigned_pm_id: v }))}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="No PM assigned" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No PM assigned</SelectItem>
                          {pms.map((pm) => (
                            <SelectItem key={pm.id} value={pm.id}>
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                                {pm.name}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Status</label>
                    <Select value={editState.status} onValueChange={(v) => setEditState(s => s && ({ ...s, status: v }))}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7 text-xs gap-1" disabled={saving || !editState.scheduled_date} onClick={() => saveEdit(appt.id)}>
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setEditingId(null)}>
                    <X className="w-3 h-3" /> Cancel
                  </Button>
                </div>
              </div>
            )
          }

          const timeLabel = appt.start_time
            ? appt.end_time ? `${formatTime(appt.start_time)} – ${formatTime(appt.end_time)}` : formatTime(appt.start_time)
            : null

          return (
            <div key={appt.id} className="flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5">
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{formatDate(appt.scheduled_date)}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[appt.status] ?? STATUS_COLORS.scheduled}`}>
                    {STATUS_LABELS[appt.status] ?? appt.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  {timeLabel && (
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeLabel}</span>
                  )}
                  {pm ? (
                    <span className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                      {pm.name}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-muted-foreground/60"><UserCircle className="w-3 h-3" />No PM</span>
                  )}
                  {appt.project_summary && (
                    <span className="truncate max-w-[160px]">{appt.project_summary}</span>
                  )}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => startEdit(appt)}>
                <Pencil className="w-3.5 h-3.5" />
              </Button>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
