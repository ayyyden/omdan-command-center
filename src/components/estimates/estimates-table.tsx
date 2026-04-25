"use client"

import { TableCell, TableRow } from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { formatCurrency, formatDate } from "@/lib/utils"
import { EstimateStatusUpdater } from "@/components/estimates/estimate-status-updater"
import { Briefcase } from "lucide-react"
import Link from "next/link"
import type { Estimate, ProjectManager } from "@/types"

interface EstimatesTableProps {
  estimates: Estimate[]
  projectManagers: ProjectManager[]
  userId: string
}

export function EstimatesTable({ estimates, projectManagers, userId }: EstimatesTableProps) {
  if (estimates.length === 0) {
    return (
      <TableRow>
        <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
          No estimates yet.{" "}
          <Link href="/estimates/new" className="text-primary hover:underline">Create your first estimate.</Link>
        </TableCell>
      </TableRow>
    )
  }

  return (
    <>
      {estimates.map((est) => {
        const jobs = (est as any).jobs
        const hasExistingJob = Array.isArray(jobs) && jobs.length > 0
        const linkedJobId: string | null = hasExistingJob ? jobs[0].id : null

        return (
          <TableRow key={est.id} className="group">
            <TableCell>
              <Link
                href={`/estimates/${est.id}`}
                className="text-base font-semibold hover:text-primary transition-colors"
              >
                {est.title}
              </Link>
            </TableCell>
            <TableCell className="text-sm">
              {est.customer ? (
                <Link href={`/customers/${est.customer_id}`} className="hover:text-primary">
                  {(est.customer as any).name}
                </Link>
              ) : "—"}
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
            <TableCell className="text-sm text-muted-foreground">
              {formatDate(est.created_at)}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {est.sent_at ? formatDate(est.sent_at) : "—"}
            </TableCell>
            <TableCell>
              {linkedJobId ? (
                <Button asChild size="sm" variant="outline" className="h-6 text-xs px-2 gap-1">
                  <Link href={`/jobs/${linkedJobId}`}>
                    <Briefcase className="w-3 h-3" />
                    View Job
                  </Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
          </TableRow>
        )
      })}
    </>
  )
}
