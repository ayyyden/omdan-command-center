import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { JobEditForm } from "@/components/jobs/job-edit-form"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function JobEditPage({ params }: PageProps) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: job }, { data: pms }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, title, description, notes, scheduled_date, scheduled_time, project_manager_id, estimated_duration_minutes, customer_id, customer:customers(name)")
      .eq("id", id)
      .single(),
    supabase
      .from("project_managers")
      .select("id, name, color")
      .eq("is_active", true)
      .order("name"),
  ])

  if (!job) notFound()

  const jobSnapshot = {
    ...(job as any),
    customer_name: (job as any).customer?.name ?? "Customer",
  }

  return (
    <div>
      <Topbar title="Edit Job" subtitle={job.title} />
      <div className="p-4 sm:p-6 max-w-2xl">
        <JobEditForm job={jobSnapshot} pms={pms ?? []} userId={user.id} />
      </div>
    </div>
  )
}
