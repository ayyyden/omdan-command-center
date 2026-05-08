import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { WorkCard } from "@/components/propstream/work-card"

interface PageProps {
  searchParams: Promise<{ list_id?: string }>
}

export default async function PropStreamWorkPage({ searchParams }: PageProps) {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "propstream:call")) redirect("/access-denied")

  const { list_id } = await searchParams

  return (
    <div className="flex flex-col h-full min-h-screen bg-muted/30">
      <WorkCard listId={list_id} />
    </div>
  )
}
