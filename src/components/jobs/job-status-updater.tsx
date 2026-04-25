"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Loader2, PlayCircle, RotateCcw } from "lucide-react"
import type { JobStatus } from "@/types"
import { logActivity, advanceCustomerStatus } from "@/lib/activity"

const JOB_STATUSES: JobStatus[] = ["scheduled", "in_progress", "completed", "on_hold", "cancelled"]

const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled:   "Scheduled",
  in_progress: "In Progress",
  completed:   "Completed",
  on_hold:     "On Hold",
  cancelled:   "Cancelled",
}

// Maps job status transitions to customer status advances
const CUSTOMER_ADVANCE: Partial<Record<JobStatus, string>> = {
  in_progress: "In Progress",
  completed:   "Completed",
}

interface JobStatusUpdaterProps {
  jobId: string
  currentStatus: JobStatus
  customerId: string
  userId: string
}

export function JobStatusUpdater({ jobId, currentStatus, customerId, userId }: JobStatusUpdaterProps) {
  const [status, setStatus] = useState<JobStatus>(currentStatus)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function applyStatus(newStatus: JobStatus) {
    if (newStatus === status || loading) return
    setLoading(true)
    const supabase = createClient()

    const updatePayload: Record<string, unknown> = { status: newStatus }
    if (newStatus === "completed") {
      updatePayload.completion_date = new Date().toISOString().split("T")[0]
    } else if (status === "completed") {
      updatePayload.completion_date = null
      updatePayload.is_archived = false
    }

    const { error } = await supabase.from("jobs").update(updatePayload).eq("id", jobId)
    if (error) {
      toast({ title: "Error updating status", description: error.message, variant: "destructive" })
      setLoading(false)
      return
    }

    // Log the status change
    await logActivity(supabase, {
      userId,
      entityType: "job",
      entityId: jobId,
      action: "status_changed",
      description: `Status changed: ${STATUS_LABELS[status]} → ${STATUS_LABELS[newStatus]}`,
      jobId,
    })

    // Advance customer status where applicable
    const customerTarget = CUSTOMER_ADVANCE[newStatus]
    if (customerTarget) {
      await advanceCustomerStatus(supabase, customerId, customerTarget)
    }

    setStatus(newStatus)
    toast({ title: STATUS_LABELS[newStatus], description: "Job status updated" })
    router.refresh()
    setLoading(false)
  }

  if (status === "on_hold") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8 gap-1.5"
          onClick={() => applyStatus("in_progress")}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <PlayCircle className="w-3.5 h-3.5" />
          )}
          Resume
        </Button>
        <Select value={status} onValueChange={(v) => applyStatus(v as JobStatus)} disabled={loading}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={() => applyStatus("scheduled")}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <RotateCcw className="w-3.5 h-3.5" />
          )}
          Reopen
        </Button>
        <Select value={status} onValueChange={(v) => applyStatus(v as JobStatus)} disabled={loading}>
          <SelectTrigger className="w-36 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  return (
    <Select value={status} onValueChange={(v) => applyStatus(v as JobStatus)} disabled={loading}>
      <SelectTrigger className="w-40 h-8 text-xs">
        {loading ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="w-3 h-3 animate-spin" />
            Updating…
          </span>
        ) : (
          <SelectValue />
        )}
      </SelectTrigger>
      <SelectContent>
        {JOB_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
