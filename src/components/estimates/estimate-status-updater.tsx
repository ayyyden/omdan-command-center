"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { CalendarClock, Loader2 } from "lucide-react"
import type { EstimateStatus, ProjectManager } from "@/types"
import { logActivity, advanceCustomerStatus } from "@/lib/activity"

interface EstimateStatusUpdaterProps {
  estimateId: string
  customerId: string
  estimateTitle: string
  currentStatus: EstimateStatus
  projectManagers: ProjectManager[]
  userId: string
  hasExistingJob: boolean
}

// Maps estimate status changes to customer CRM advancement.
// Uses advanceCustomerStatus — only moves forward, never back, never overwrites Closed Lost.
// "rejected" is intentionally absent: rejecting an estimate does not auto-close the customer.
const CUSTOMER_STATUS_ADVANCE: Partial<Record<EstimateStatus, string>> = {
  sent:     "Estimate Sent",
  approved: "Approved",
}

export function EstimateStatusUpdater({
  estimateId,
  customerId,
  estimateTitle,
  currentStatus,
  projectManagers,
  userId,
  hasExistingJob,
}: EstimateStatusUpdaterProps) {
  const [status, setStatus] = useState<EstimateStatus>(currentStatus)
  const [hasJob, setHasJob] = useState(hasExistingJob)
  const [schedulingOpen, setSchedulingOpen] = useState(false)
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().split("T")[0])
  const [scheduledTime, setScheduledTime] = useState("08:00")
  // "none" is the sentinel for "no PM selected" — Radix Select disallows empty string values
  const [pmId, setPmId] = useState<string>("none")
  const [statusSaving, setStatusSaving] = useState(false)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  // Step 1: save the status change to DB immediately, then open scheduling modal if approved.
  async function handleStatusChange(newStatus: EstimateStatus) {
    if (newStatus === status) return
    setStatusSaving(true)
    const supabase = createClient()

    const now = new Date().toISOString()
    const estimateUpdate: Record<string, unknown> = { status: newStatus }
    if (newStatus === "sent")     estimateUpdate.sent_at = now
    if (newStatus === "approved") estimateUpdate.approved_at = now

    const { error } = await supabase.from("estimates").update(estimateUpdate).eq("id", estimateId)
    if (error) {
      toast({ title: "Error saving status", description: error.message, variant: "destructive" })
      setStatusSaving(false)
      return
    }

    // Advance customer status — never downgrades, never overwrites Closed Lost
    const customerTarget = CUSTOMER_STATUS_ADVANCE[newStatus]
    if (customerTarget) {
      await advanceCustomerStatus(supabase, customerId, customerTarget)
    }

    const descriptions: Partial<Record<EstimateStatus, string>> = {
      draft:    `Estimate "${estimateTitle}" reverted to draft`,
      sent:     `Estimate "${estimateTitle}" marked as sent`,
      approved: `Estimate "${estimateTitle}" approved`,
      rejected: `Estimate "${estimateTitle}" marked as rejected`,
    }
    await logActivity(supabase, {
      userId,
      entityType: "estimate",
      entityId: estimateId,
      action: `estimate_${newStatus}`,
      description: descriptions[newStatus] ?? `Estimate status changed to ${newStatus}`,
    })

    setStatus(newStatus)
    setStatusSaving(false)
    toast({ title: "Status updated", description: `Estimate marked as ${newStatus}` })

    if (newStatus === "approved") setSchedulingOpen(true)
    router.refresh()
  }

  // Step 2: create the job from an already-approved estimate.
  async function handleScheduleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setScheduleSaving(true)
    const supabase = createClient()

    // Guard: never create a duplicate job for the same estimate
    const { data: existingJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("estimate_id", estimateId)
      .maybeSingle()

    if (existingJob) {
      toast({ title: "Job already exists", description: "This estimate already has a job." })
      setHasJob(true)
      setSchedulingOpen(false)
      setScheduleSaving(false)
      return
    }

    const resolvedPmId = pmId === "none" ? null : pmId

    const { data: newJob, error: jobError } = await supabase
      .from("jobs")
      .insert({
        customer_id: customerId,
        estimate_id: estimateId,
        title: estimateTitle,
        status: "scheduled",
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime || null,
        project_manager_id: resolvedPmId,
        user_id: userId,
      })
      .select("id")
      .single()

    if (jobError) {
      toast({ title: "Job creation failed", description: jobError.message, variant: "destructive" })
      setScheduleSaving(false)
      return
    }

    // Advance customer to "Scheduled"
    await advanceCustomerStatus(supabase, customerId, "Scheduled")

    const pmName = resolvedPmId
      ? (projectManagers.find((p) => p.id === resolvedPmId)?.name ?? "Unknown PM")
      : "Unassigned"

    await Promise.all([
      logActivity(supabase, {
        userId,
        entityType: "job",
        entityId: newJob.id,
        action: "job_created",
        description: `Job created from estimate "${estimateTitle}"`,
        jobId: newJob.id,
      }),
      logActivity(supabase, {
        userId,
        entityType: "job",
        entityId: newJob.id,
        action: "schedule_updated",
        description: `Job scheduled for ${scheduledDate}${scheduledTime ? ` at ${scheduledTime}` : ""} — PM: ${pmName}`,
        jobId: newJob.id,
      }),
    ])

    setHasJob(true)
    setSchedulingOpen(false)
    setScheduleSaving(false)
    toast({ title: "Job scheduled!", description: `${scheduledDate} — PM: ${pmName}` })
    router.refresh()
  }

  return (
    <>
      <div className="flex items-center gap-1.5 flex-wrap">
        <Select
          value={status}
          onValueChange={(v) => handleStatusChange(v as EstimateStatus)}
          disabled={statusSaving}
        >
          <SelectTrigger className="w-[130px] h-8 text-xs">
            {statusSaving
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <SelectValue />}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>

        {status === "approved" && !hasJob && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs px-2 gap-1"
            onClick={() => setSchedulingOpen(true)}
          >
            <CalendarClock className="w-3.5 h-3.5" />
            Schedule
          </Button>
        )}
      </div>

      <Dialog open={schedulingOpen} onOpenChange={(open) => { if (!open) setSchedulingOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule Job</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleScheduleSubmit} className="space-y-4 pt-2">
            <p className="text-sm text-muted-foreground">
              Create a job and set the start date for{" "}
              <span className="font-medium text-foreground">{estimateTitle}</span>.
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="sched-date">Start Date *</Label>
                <Input
                  id="sched-date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sched-time">Time (optional)</Label>
                <Input
                  id="sched-time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pm-select">Project Manager (optional)</Label>
              <Select value={pmId} onValueChange={setPmId}>
                <SelectTrigger id="pm-select"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {projectManagers.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => setSchedulingOpen(false)}>
                Schedule Later
              </Button>
              <Button type="submit" disabled={scheduleSaving}>
                {scheduleSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Create Job & Schedule
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
