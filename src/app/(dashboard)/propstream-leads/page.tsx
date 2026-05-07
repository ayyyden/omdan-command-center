import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { LeadsDashboard } from "@/components/propstream/leads-dashboard"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"

export default async function PropStreamLeadsPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "propstream:view")) redirect("/access-denied")

  const { supabase, role } = session

  const { data: lists } = await supabase
    .from("propstream_lists")
    .select("id, name, filename, imported_count, callable_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50)

  const canImport = can(role, "propstream:import")

  return (
    <div className="flex flex-col h-full">
      <Topbar
        title="Lead Operating Center"
        subtitle="PropStream property owner leads"
        actions={
          canImport ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/propstream-leads/import">
                <Upload className="w-4 h-4 mr-2" />
                Import CSV
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="flex-1 overflow-hidden p-4 sm:p-6">
        <LeadsDashboard lists={lists ?? []} canCall={can(role, "propstream:call")} />
      </div>
    </div>
  )
}
