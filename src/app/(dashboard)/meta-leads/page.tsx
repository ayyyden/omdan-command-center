import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { MetaLeadsWorkspace } from "@/components/meta-leads/meta-leads-workspace"
import { AddLeadDialog } from "@/components/meta-leads/add-lead-dialog"

export default async function MetaLeadsPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "meta_leads:view")) redirect("/access-denied")

  return (
    <div className="flex flex-col md:h-full">
      <Topbar
        title="Meta Lead Jobs"
        subtitle="Facebook / Meta Lead Ads call list"
        actions={<AddLeadDialog />}
      />
      {/* Mobile: normal page scroll, each list gets its own capped scroll box below.
          Desktop (md+): fixed-height kanban board, unchanged — nothing scrolls but the columns themselves. */}
      <div className="flex-1 md:overflow-hidden p-4 sm:p-6">
        <MetaLeadsWorkspace />
      </div>
    </div>
  )
}
