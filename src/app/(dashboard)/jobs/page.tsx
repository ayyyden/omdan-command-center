import { getSessionMember, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { Topbar } from "@/components/shared/topbar"
import { Badge } from "@/components/ui/badge"
import { JobsBulkTable } from "@/components/jobs/jobs-bulk-table"
import Link from "next/link"
import type { JobStatus } from "@/types"

const JOB_STATUSES: JobStatus[] = ["scheduled", "in_progress", "completed", "on_hold", "cancelled"]

interface PageProps {
  searchParams: Promise<{ status?: string; archived?: string }>
}

export default async function JobsPage({ searchParams }: PageProps) {
  const { status, archived } = await searchParams
  const isArchived = archived === "true"
  const session = await getSessionMember()
  if (!session) return null
  const { userId, role, pmId, supabase } = session

  // Lazily archive completed jobs older than 14 days
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  await supabase
    .from("jobs")
    .update({ is_archived: true })
    .eq("status", "completed")
    .eq("is_archived", false)
    .lte("completion_date", twoWeeksAgo)

  let query = supabase
    .from("jobs")
    .select("*, customer:customers(name)")
    .eq("is_archived", isArchived)
    .order("scheduled_date", { ascending: false })

  if (hasJobScope(role)) query = query.eq("project_manager_id", pmId ?? NO_ROWS_ID)
  if (!isArchived && status) query = query.eq("status", status)

  const { data: jobs } = await query

  return (
    <div>
      <Topbar title="Jobs" subtitle={`${jobs?.length ?? 0} jobs${isArchived ? " · Archived" : ""}`} />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Link href="/jobs">
            <Badge variant={!status && !isArchived ? "default" : "outline"} className="cursor-pointer">All</Badge>
          </Link>
          {!isArchived && JOB_STATUSES.map((s) => (
            <Link key={s} href={`/jobs?status=${s}`}>
              <Badge variant={status === s ? "default" : "outline"} className="cursor-pointer capitalize">
                {s.replace("_", " ")}
              </Badge>
            </Link>
          ))}
          <Link href="/jobs?archived=true">
            <Badge variant={isArchived ? "default" : "outline"} className="cursor-pointer">Archived</Badge>
          </Link>
        </div>

        <JobsBulkTable jobs={(jobs ?? []) as any[]} userId={userId} />
      </div>
    </div>
  )
}
