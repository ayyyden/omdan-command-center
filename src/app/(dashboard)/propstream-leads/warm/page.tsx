import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { LeadsDashboard } from "@/components/propstream/leads-dashboard"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"

export default async function WarmLeadsPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "propstream:view")) redirect("/access-denied")

  const { supabase, role } = session

  const { data: lists } = await supabase
    .from("propstream_lists")
    .select("id, name, filename, imported_count, callable_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title="Warm Leads"
        subtitle="Leads ready to convert to estimates"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/propstream-leads">
              <ArrowLeft className="w-4 h-4 mr-1" />
              All Leads
            </Link>
          </Button>
        }
      />
      <div className="flex-1 overflow-hidden p-4 sm:p-6">
        <LeadsDashboard
          lists={lists ?? []}
          canCall={can(role, "propstream:call")}
          defaultStatus="warm_lead"
        />
      </div>
    </div>
  )
}
