import { createClient } from "@/lib/supabase/server"
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
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  let query = supabase
    .from("estimates")
    .select("*, customer:customers(name), jobs(id)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })

  if (status) query = query.eq("status", status)

  const [{ data: estimates }, { data: pms }] = await Promise.all([
    query,
    supabase.from("project_managers").select("*").eq("user_id", user.id).eq("is_active", true).order("name"),
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

      <div className="p-6 space-y-4">
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
          userId={user.id}
        />
      </div>
    </div>
  )
}
