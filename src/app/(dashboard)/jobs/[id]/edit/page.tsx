import { notFound, redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { JobEditForm } from "@/components/jobs/job-edit-form"
import { getSessionMember, hasJobScope } from "@/lib/auth-helpers"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function JobEditPage({ params }: PageProps) {
  const { id } = await params

  const session = await getSessionMember()
  if (!session) redirect("/login")
  const { userId, role, pmId, supabase } = session

  const canChangePm = !hasJobScope(role)

  const [{ data: job }, { data: pms }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, description, notes, scheduled_date, scheduled_time, project_manager_id, estimated_duration_minutes, customer_id, customer:customers(name)")
      .eq("id", id)
      .single(),
    canChangePm
      ? supabase.from("project_managers").select("id, name, color").eq("is_active", true).order("name")
      : Promise.resolve({ data: [] as { id: string; name: string; color: string }[] }),
  ])

  if (!job) notFound()

  // PM scope enforcement — block editing a job not assigned to this PM
  if (hasJobScope(role) && (job as any).project_manager_id !== pmId) redirect("/access-denied")

  const jobSnapshot = {
    ...(job as any),
    customer_name: (job as any).customer?.name ?? "Customer",
  }

  return (
    <div>
      <Topbar title="Edit Job" subtitle={job.title} />
      <div className="p-4 sm:p-6 max-w-2xl">
        <JobEditForm job={jobSnapshot} pms={pms ?? []} userId={userId} canChangePm={canChangePm} />
      </div>
    </div>
  )
}
