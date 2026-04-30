"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { JobStatusBadge } from "@/components/shared/status-badge"
import { InlineJobStatus } from "@/components/jobs/inline-job-status"
import { BulkBar, HeaderCheckbox } from "@/components/shared/bulk-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { useSelection } from "@/hooks/use-selection"
import { useToast } from "@/hooks/use-toast"
import { formatDate, getTodayLA } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { AlertTriangle, Briefcase } from "lucide-react"
import Link from "next/link"
import type { JobStatus } from "@/types"

const OVERDUE_STATUSES = new Set<JobStatus>(["scheduled", "in_progress"])

interface JobRow {
  id: string
  title: string
  description: string | null
  status: string
  scheduled_date: string | null
  completion_date: string | null
  customer_id: string
  is_archived: boolean
  customer?: { name: string } | null
}

interface Props {
  jobs: JobRow[]
  userId: string
}

export function JobsBulkTable({ jobs, userId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const todayLA = getTodayLA()
  const allIds  = jobs.map((j) => j.id)
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const supabase = createClient()
    const ids = Array.from(selected)
    const { error } = await supabase.from("jobs").delete().in("id", ids)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Deleted ${ids.length} job${ids.length !== 1 ? "s" : ""}` })
    clear()
    setConfirmOpen(false)
    router.refresh()
  }

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Briefcase className="w-8 h-8 text-muted-foreground/40" />
      <div>
        <p className="font-medium text-muted-foreground">No jobs yet</p>
        <p className="text-sm text-muted-foreground/60 mt-0.5">Convert an approved estimate to create your first job.</p>
      </div>
      <Link href="/estimates" className="text-sm font-medium text-primary hover:underline">
        View estimates →
      </Link>
    </div>
  )

  return (
    <div className="space-y-3">
      <BulkBar
        count={selected.size}
        entity="job"
        onDelete={() => setConfirmOpen(true)}
        onClear={clear}
        deleting={deleting}
      />

      {jobs.length === 0 ? (
        <div className="rounded-lg border bg-card">{emptyState}</div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="sm:hidden space-y-2">
            {jobs.map((job) => {
              const isOverdue =
                !!job.scheduled_date &&
                job.scheduled_date < todayLA &&
                OVERDUE_STATUSES.has(job.status as JobStatus)

              return (
                <div
                  key={job.id}
                  className={cn(
                    "rounded-lg border bg-card p-3 flex gap-3",
                    selected.has(job.id) ? "border-primary/50 bg-primary/5" :
                    isOverdue            ? "border-warning/30 bg-warning/5" : ""
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(job.id)}
                    onChange={(e) => toggle(job.id, e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-primary mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/jobs/${job.id}`} className="font-semibold hover:text-primary leading-tight">
                        {job.title}
                      </Link>
                      {isOverdue && (
                        <Badge variant="warning" className="gap-1 text-[10px] px-1.5 py-0 shrink-0">
                          <AlertTriangle className="w-2.5 h-2.5" />Overdue
                        </Badge>
                      )}
                    </div>
                    {job.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{job.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(job.customer as any)?.name ?? "—"}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <div>
                        {job.is_archived ? (
                          <JobStatusBadge status={job.status as JobStatus} />
                        ) : (
                          <InlineJobStatus jobId={job.id} currentStatus={job.status as JobStatus} />
                        )}
                      </div>
                      {job.scheduled_date && (
                        <span className={cn(
                          "text-xs",
                          isOverdue ? "text-warning font-medium" : "text-muted-foreground"
                        )}>
                          {formatDate(job.scheduled_date)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block rounded-lg border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10 px-3">
                    <HeaderCheckbox allSelected={allSelected} someSelected={someSelected} onChange={toggleAll} />
                  </TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => {
                  const isOverdue =
                    !!job.scheduled_date &&
                    job.scheduled_date < todayLA &&
                    OVERDUE_STATUSES.has(job.status as JobStatus)

                  return (
                    <TableRow
                      key={job.id}
                      className={
                        selected.has(job.id) ? "bg-primary/5" :
                        isOverdue            ? "bg-warning/5"  : ""
                      }
                    >
                      <TableCell className="px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(job.id)}
                          onChange={(e) => toggle(job.id, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/jobs/${job.id}`} className="text-base font-semibold hover:text-primary transition-colors">
                          {job.title}
                        </Link>
                        {job.description && (
                          <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{job.description}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(job.customer as any)?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          {job.is_archived ? (
                            <JobStatusBadge status={job.status as JobStatus} />
                          ) : (
                            <InlineJobStatus jobId={job.id} currentStatus={job.status as JobStatus} />
                          )}
                          {isOverdue && (
                            <Badge variant="warning" className="gap-1 text-[10px] px-1.5 py-0 shrink-0">
                              <AlertTriangle className="w-2.5 h-2.5" />Overdue
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`text-sm ${isOverdue ? "text-warning font-medium" : "text-muted-foreground"}`}>
                        {formatDate(job.scheduled_date)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {job.completion_date ? formatDate(job.completion_date) : "—"}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <ConfirmDeleteDialog
        open={confirmOpen}
        count={selected.size}
        entity="job"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        deleting={deleting}
      />
    </div>
  )
}
