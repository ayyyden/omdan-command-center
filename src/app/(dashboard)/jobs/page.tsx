import { getSessionMember, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { Topbar } from "@/components/shared/topbar"
import { Badge } from "@/components/ui/badge"
import { JobsBulkTable } from "@/components/jobs/jobs-bulk-table"
import { AddJobDialog } from "@/components/jobs/add-job-dialog"
import Link from "next/link"
import type { JobStatus } from "@/types"

const ACTIVE_STATUSES: JobStatus[] = ["scheduled", "in_progress"]
const ALL_STATUSES: JobStatus[]    = ["scheduled", "in_progress", "completed", "on_hold", "cancelled"]

interface PageProps {
  searchParams: Promise<{ status?: string; show?: string }>
}

export default async function JobsPage({ searchParams }: PageProps) {
  const { status, show } = await searchParams
  const showAll     = show === "all"
  // Default view: only active jobs (scheduled + in_progress)
  const isActiveTab = !showAll && !status

  const session = await getSessionMember()
  if (!session) return null
  const { userId, role, pmId, supabase } = session

  // No archiving/hiding here — every job is visible somewhere (Active,
  // a status tab, or All). "Archived" used to silently move completed
  // jobs older than 14 days out of every tab except a separate Archived
  // filter, which is exactly the "can't see all jobs" bug.
  let query = supabase
    .from("jobs")
    .select("*, customer:customers(name)")
    .order("scheduled_date", { ascending: false })

  if (hasJobScope(role)) query = query.eq("project_manager_id", pmId ?? NO_ROWS_ID)

  if (isActiveTab) {
    query = query.in("status", ACTIVE_STATUSES)
  } else if (!showAll && status) {
    query = query.eq("status", status)
  }

  const { data: jobs } = await query

  const { data: pms } = await supabase
    .from("project_managers")
    .select("id, name, color")
    .eq("is_active", true)
    .order("name")

  const tabLabel = isActiveTab ? " · Active" : showAll ? " · All" : ""

  return (
    <div>
      <Topbar
        title="Jobs"
        subtitle={`${jobs?.length ?? 0} job${(jobs?.length ?? 0) !== 1 ? "s" : ""}${tabLabel}`}
        actions={<AddJobDialog userId={userId} pms={pms ?? []} />}
      />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {/* Active = default tab */}
          <Link href="/jobs">
            <Badge variant={isActiveTab ? "default" : "outline"} className="cursor-pointer">Active</Badge>
          </Link>
          {/* Individual status filters */}
          {ALL_STATUSES.map((s) => (
            <Link key={s} href={`/jobs?status=${s}`}>
              <Badge variant={status === s ? "default" : "outline"} className="cursor-pointer capitalize">
                {s.replace("_", " ")}
              </Badge>
            </Link>
          ))}
          {/* Show every job, regardless of status */}
          <Link href="/jobs?show=all">
            <Badge variant={showAll ? "default" : "outline"} className="cursor-pointer">All</Badge>
          </Link>
        </div>

        <JobsBulkTable jobs={(jobs ?? []) as any[]} userId={userId} />
      </div>
    </div>
  )
}
