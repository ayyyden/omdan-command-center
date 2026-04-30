import { getSessionMember, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { Topbar } from "@/components/shared/topbar"
import { SchedulerClient } from "@/components/scheduler/scheduler-client"

interface PageProps {
  searchParams: Promise<{ date?: string }>
}

function getTodayLA(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date())
}

export default async function SchedulerPage({ searchParams }: PageProps) {
  const { date: dateParam } = await searchParams
  const todayLA = getTodayLA()
  const viewingDate = dateParam ?? todayLA

  const session = await getSessionMember()
  if (!session) return null
  const { userId, role, pmId, supabase } = session

  let jobsQuery = supabase
    .from("jobs")
    .select("id, title, scheduled_date, scheduled_time, status, project_manager_id, estimated_duration_minutes, customer_id, customer:customers(name)")
    .or(`scheduled_date.eq.${viewingDate},and(scheduled_date.lt.${viewingDate},status.not.in.(completed,cancelled))`)
    .order("scheduled_time", { ascending: true, nullsFirst: false })

  if (hasJobScope(role)) jobsQuery = jobsQuery.eq("project_manager_id", pmId ?? NO_ROWS_ID)

  const [{ data: pmsRaw }, { data: jobsRaw }, { data: remindersRaw }] = await Promise.all([
    supabase
      .from("project_managers")
      .select("id, name, color, phone, email")
      .eq("is_active", true)
      .order("name"),
    jobsQuery,
    supabase
      .from("reminders")
      .select("id, title, due_date, due_time, type, completed_at, notes, duration_minutes")
      .eq("due_date", viewingDate)
      .order("due_time", { ascending: true, nullsFirst: false }),
  ])

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Topbar title="Scheduler" subtitle="Daily schedule view" />
      <SchedulerClient
        jobs={(jobsRaw ?? []) as any[]}
        pms={(pmsRaw ?? []) as any[]}
        reminders={(remindersRaw ?? []) as any[]}
        date={viewingDate}
        todayLA={todayLA}
        userId={userId}
      />
    </div>
  )
}
