import { getSessionMember, NO_ROWS_ID } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EstimatesBulkTable } from "@/components/estimates/estimates-bulk-table"
import { Plus } from "lucide-react"
import Link from "next/link"
import type { Estimate, ProjectManager } from "@/types"

interface PageProps {
  searchParams: Promise<{ status?: string }>
}

export default async function EstimatesPage({ searchParams }: PageProps) {
  const { status } = await searchParams

  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "estimates:view")) redirect("/access-denied")
  const { userId, role, pmId, supabase } = session

  const isScopedPM = role === "project_manager"

  // For PM: resolve accessible estimate IDs via job ownership + own creation
  let scopedEstimateIds: string[] | null = null
  if (isScopedPM) {
    const [{ data: pmJobs }, { data: ownEstimates }] = await Promise.all([
      supabase
        .from("jobs")
        .select("estimate_id")
        .eq("project_manager_id", pmId ?? NO_ROWS_ID)
        .not("estimate_id", "is", null),
      supabase.from("estimates").select("id").eq("user_id", userId),
    ])
    const fromJobs = (pmJobs ?? []).map((j: any) => j.estimate_id).filter(Boolean) as string[]
    const fromOwn  = (ownEstimates ?? []).map((e: any) => e.id)
    scopedEstimateIds = [...new Set([...fromJobs, ...fromOwn])]
  }

  let query = supabase
    .from("estimates")
    .select("*, customer:customers(name), jobs(id)")
    .order("created_at", { ascending: false })

  if (scopedEstimateIds !== null) {
    query = scopedEstimateIds.length > 0
      ? query.in("id", scopedEstimateIds)
      : query.eq("id", NO_ROWS_ID)
  }
  if (status) query = query.eq("status", status)

  const [{ data: estimates }, { data: pms }] = await Promise.all([
    query,
    supabase.from("project_managers").select("*").eq("is_active", true).order("name"),
  ])

  return (
    <div>
      <Topbar
        title="Estimates"
        subtitle={`${estimates?.length ?? 0} estimates`}
        actions={
          <Button asChild>
            <Link href="/estimates/new"><Plus className="w-4 h-4 mr-2" />New Estimate</Link>
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          {(["all", "draft", "sent", "approved", "rejected"] as const).map((s) => (
            <Link key={s} href={s === "all" ? "/estimates" : `/estimates?status=${s}`}>
              <Badge variant={(!status && s === "all") || status === s ? "default" : "outline"} className="cursor-pointer capitalize">{s}</Badge>
            </Link>
          ))}
        </div>

        <EstimatesBulkTable
          estimates={(estimates ?? []) as Estimate[]}
          projectManagers={(pms ?? []) as ProjectManager[]}
          userId={userId}
        />
      </div>
    </div>
  )
}
