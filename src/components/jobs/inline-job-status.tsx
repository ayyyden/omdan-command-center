"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { JobStatus } from "@/types"

const JOB_STATUSES: JobStatus[] = ["scheduled", "in_progress", "completed", "on_hold", "cancelled"]

const STATUS_LABELS: Record<JobStatus, string> = {
  scheduled:   "Scheduled",
  in_progress: "In Progress",
  completed:   "Completed",
  on_hold:     "On Hold",
  cancelled:   "Cancelled",
}

interface InlineJobStatusProps {
  jobId: string
  currentStatus: JobStatus
}

export function InlineJobStatus({ jobId, currentStatus }: InlineJobStatusProps) {
  const [status, setStatus] = useState<JobStatus>(currentStatus)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleChange(newStatus: JobStatus) {
    if (newStatus === status || loading) return
    setLoading(true)
    const supabase = createClient()

    const payload: Record<string, unknown> = { status: newStatus }
    if (newStatus === "completed") {
      payload.completion_date = new Date().toISOString().split("T")[0]
    } else if (status === "completed") {
      payload.completion_date = null
      payload.is_archived = false
    }

    const { error } = await supabase.from("jobs").update(payload).eq("id", jobId)
    setLoading(false)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    setStatus(newStatus)
    router.refresh()
  }

  return (
    <Select value={status} onValueChange={(v) => handleChange(v as JobStatus)} disabled={loading}>
      <SelectTrigger className="h-7 w-32 text-xs border-transparent bg-transparent hover:border-input hover:bg-background focus:border-input focus:bg-background transition-colors px-2">
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
  )
}
