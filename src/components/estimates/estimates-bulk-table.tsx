"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { EstimateStatusUpdater } from "@/components/estimates/estimate-status-updater"
import { BulkBar, HeaderCheckbox } from "@/components/shared/bulk-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { useSelection } from "@/hooks/use-selection"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"
import { Briefcase } from "lucide-react"
import Link from "next/link"
import type { Estimate, ProjectManager } from "@/types"

interface Props {
  estimates: Estimate[]
  projectManagers: ProjectManager[]
  userId: string
}

export function EstimatesBulkTable({ estimates, projectManagers, userId }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const allIds = estimates.map((e) => e.id)
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const supabase = createClient()
    const ids = Array.from(selected)
    const { error } = await supabase.from("estimates").delete().in("id", ids)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Deleted ${ids.length} estimate${ids.length !== 1 ? "s" : ""}` })
    clear()
    setConfirmOpen(false)
    router.refresh()
  }

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <Briefcase className="w-8 h-8 text-muted-foreground/40" />
      <div>
        <p className="font-medium text-muted-foreground">No estimates yet</p>
        <p className="text-sm text-muted-foreground/60 mt-0.5">Create your first estimate to send to a customer.</p>
      </div>
      <Link href="/estimates/new" className="text-sm font-medium text-primary hover:underline">
        Create your first estimate →
      </Link>
    </div>
  )

  return (
    <div className="space-y-3">
      <BulkBar
        count={selected.size}
        entity="estimate"
        onDelete={() => setConfirmOpen(true)}
        onClear={clear}
        deleting={deleting}
      />

      {estimates.length === 0 ? (
        <div className="rounded-lg border bg-card">{emptyState}</div>
      ) : (
        <>
          {/* Mobile card list */}
          <div className="sm:hidden space-y-2">
            {estimates.map((est) => {
              const jobs = (est as any).jobs
              const hasExistingJob = Array.isArray(jobs) && jobs.length > 0
              const linkedJobId: string | null = hasExistingJob ? jobs[0].id : null

              return (
                <div
                  key={est.id}
                  className={cn(
                    "rounded-lg border bg-card p-3 flex gap-3",
                    selected.has(est.id) ? "border-primary/50 bg-primary/5" : ""
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(est.id)}
                    onChange={(e) => toggle(est.id, e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-primary mt-0.5 shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <Link href={`/estimates/${est.id}`} className="font-semibold hover:text-primary leading-tight">
                        {est.title}
                      </Link>
                      <span className="font-bold tabular-nums text-sm shrink-0">
                        {formatCurrency(Number(est.total))}
                      </span>
                    </div>
                    {est.customer && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(est.customer as any).name}
                      </p>
                    )}
                    <div className="flex items-center justify-between mt-2 gap-2">
                      <EstimateStatusUpdater
                        estimateId={est.id}
                        customerId={est.customer_id}
                        estimateTitle={est.title}
                        currentStatus={est.status}
                        projectManagers={projectManagers}
                        userId={userId}
                        hasExistingJob={hasExistingJob}
                      />
                      <div className="flex items-center gap-2 shrink-0">
                        {linkedJobId && (
                          <Button asChild size="sm" variant="outline" className="h-6 text-xs px-2 gap-1">
                            <Link href={`/jobs/${linkedJobId}`}>
                              <Briefcase className="w-3 h-3" />Job
                            </Link>
                          </Button>
                        )}
                        <span className="text-xs text-muted-foreground">{formatDate(est.created_at)}</span>
                      </div>
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
                  <TableHead>Title</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Job</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {estimates.map((est) => {
                  const jobs = (est as any).jobs
                  const hasExistingJob = Array.isArray(jobs) && jobs.length > 0
                  const linkedJobId: string | null = hasExistingJob ? jobs[0].id : null

                  return (
                    <TableRow key={est.id} className={selected.has(est.id) ? "bg-primary/5" : ""}>
                      <TableCell className="px-3">
                        <input
                          type="checkbox"
                          checked={selected.has(est.id)}
                          onChange={(e) => toggle(est.id, e.target.checked)}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </TableCell>
                      <TableCell>
                        <Link href={`/estimates/${est.id}`} className="text-base font-semibold hover:text-primary transition-colors">
                          {est.title}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {est.customer ? (est.customer as any).name : "—"}
                      </TableCell>
                      <TableCell className="text-sm font-semibold tabular-nums">
                        {formatCurrency(Number(est.total))}
                      </TableCell>
                      <TableCell>
                        <EstimateStatusUpdater
                          estimateId={est.id}
                          customerId={est.customer_id}
                          estimateTitle={est.title}
                          currentStatus={est.status}
                          projectManagers={projectManagers}
                          userId={userId}
                          hasExistingJob={hasExistingJob}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(est.created_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {est.sent_at ? formatDate(est.sent_at) : "—"}
                      </TableCell>
                      <TableCell>
                        {linkedJobId ? (
                          <Button asChild size="sm" variant="outline" className="h-6 text-xs px-2 gap-1">
                            <Link href={`/jobs/${linkedJobId}`}>
                              <Briefcase className="w-3 h-3" />View Job
                            </Link>
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
        entity="estimate"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        deleting={deleting}
      />
    </div>
  )
}
