"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity"
import { upsertJobReminders } from "@/lib/reminders"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2 } from "lucide-react"

const DURATION_OPTIONS = [
  { value: 30,  label: "30 min" },
  { value: 60,  label: "1 hour" },
  { value: 90,  label: "1.5 hours" },
  { value: 120, label: "2 hours" },
  { value: 150, label: "2.5 hours" },
  { value: 180, label: "3 hours" },
  { value: 240, label: "4 hours" },
  { value: 300, label: "5 hours" },
  { value: 360, label: "6 hours" },
  { value: 480, label: "8 hours" },
  { value: 600, label: "10 hours" },
  { value: 720, label: "12 hours" },
]

interface PmInfo {
  id: string
  name: string
  color: string
}

interface JobSnapshot {
  id: string
  title: string
  description: string | null
  notes: string | null
  scheduled_date: string | null
  scheduled_time: string | null
  project_manager_id: string | null
  estimated_duration_minutes: number
  customer_id: string
  customer_name: string
}

interface JobEditFormProps {
  job: JobSnapshot
  pms: PmInfo[]
  userId: string
  canChangePm?: boolean
}

function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function nearestDuration(mins: number): number {
  const values = DURATION_OPTIONS.map((o) => o.value)
  return values.includes(mins) ? mins : 120
}

export function JobEditForm({ job, pms, userId, canChangePm = true }: JobEditFormProps) {
  const [title, setTitle] = useState(job.title)
  const [description, setDescription] = useState(job.description ?? "")
  const [notes, setNotes] = useState(job.notes ?? "")
  const [scheduledDate, setScheduledDate] = useState(job.scheduled_date ?? "")
  const [scheduledTime, setScheduledTime] = useState(
    job.scheduled_time ? job.scheduled_time.slice(0, 5) : ""
  )
  const [pmId, setPmId] = useState(job.project_manager_id ?? "none")
  const [durationMins, setDurationMins] = useState(nearestDuration(job.estimated_duration_minutes))
  const [saving, setSaving] = useState(false)

  const router = useRouter()
  const { toast } = useToast()

  async function handleSave() {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" })
      return
    }
    setSaving(true)
    const supabase = createClient()

    const newPmId = pmId === "none" ? null : pmId

    const updatePayload: Record<string, unknown> = {
      title: title.trim(),
      description: description.trim() || null,
      notes: notes.trim() || null,
      scheduled_date: scheduledDate || null,
      scheduled_time: scheduledTime || null,
      estimated_duration_minutes: durationMins,
    }
    if (canChangePm) updatePayload.project_manager_id = newPmId

    const { error } = await supabase.from("jobs").update(updatePayload).eq("id", job.id)

    if (error) {
      toast({ title: "Error saving job", description: error.message, variant: "destructive" })
      setSaving(false)
      return
    }

    // Activity logging — only log what actually changed
    const scheduleChanged =
      scheduledDate !== (job.scheduled_date ?? "") ||
      scheduledTime !== (job.scheduled_time ? job.scheduled_time.slice(0, 5) : "")
    const pmChanged = newPmId !== job.project_manager_id
    const detailsChanged =
      title.trim() !== job.title ||
      description.trim() !== (job.description ?? "") ||
      notes.trim() !== (job.notes ?? "") ||
      durationMins !== job.estimated_duration_minutes

    if (scheduleChanged) {
      const dateStr = scheduledDate
        ? new Date(scheduledDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        : "no date"
      const timeStr = scheduledTime ? ` at ${formatTime12(scheduledTime)}` : ""
      await logActivity(supabase, {
        userId,
        entityType: "job",
        entityId: job.id,
        action: "schedule_updated",
        description: `Schedule set to ${dateStr}${timeStr}`,
        jobId: job.id,
      })

      // Refresh job reminders whenever the schedule changes
      await upsertJobReminders(supabase, {
        userId,
        jobId:         job.id,
        customerId:    job.customer_id,
        customerName:  job.customer_name,
        scheduledDate: scheduledDate || null,
        scheduledTime: scheduledTime || null,
      })
    }

    if (pmChanged) {
      const pm = pms.find((p) => p.id === newPmId)
      await logActivity(supabase, {
        userId,
        entityType: "job",
        entityId: job.id,
        action: "pm_changed",
        description: newPmId === null ? "PM assignment removed" : `PM assigned: ${pm?.name ?? "Unknown"}`,
        jobId: job.id,
      })
    }

    if (detailsChanged) {
      await logActivity(supabase, {
        userId,
        entityType: "job",
        entityId: job.id,
        action: "updated",
        description: "Job details updated",
        jobId: job.id,
      })
    }

    toast({ title: "Saved", description: "Job updated successfully" })
    router.push(`/jobs/${job.id}`)
    router.refresh()
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        {/* Title */}
        <div className="space-y-1.5">
          <Label htmlFor="title">Job Title *</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Master Bath Remodel"
          />
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief job description or scope of work..."
            className="min-h-[80px]"
          />
        </div>

        {/* Schedule */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="date">Scheduled Date</Label>
            <Input
              id="date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="time">Start Time</Label>
            <Input
              id="time"
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
            />
          </div>
        </div>

        {/* PM + Duration */}
        <div className={`grid gap-4 ${canChangePm ? "grid-cols-2" : "grid-cols-1"}`}>
          {canChangePm && (
            <div className="space-y-1.5">
              <Label>Project Manager</Label>
              <Select value={pmId} onValueChange={setPmId}>
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {pms.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                        {pm.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Estimated Duration</Label>
            <Select value={String(durationMins)} onValueChange={(v) => setDurationMins(Number(v))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DURATION_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Notes */}
        <div className="space-y-1.5">
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes, reminders, special instructions..."
            className="min-h-[100px]"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-2 border-t">
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push(`/jobs/${job.id}`)}
            disabled={saving}
          >
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
