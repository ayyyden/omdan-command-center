import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { CalendarAgenda } from "@/components/calendar/calendar-agenda"

export const dynamic = "force-dynamic"

// Replaces the old internal day-by-day scheduler with a live view of the
// real Google Calendar — jobs, lead appointments, meta-lead calls, and
// reminders all sync there now (see job-calendar-sync.ts,
// lead-appointment-calendar-sync.ts, meta-leads outcome route, and Lia's
// create_reminder), so this is the actual source of truth instead of a
// second, easy-to-drift copy of the same data.
//
// Deliberately NOT a public Google Calendar iframe embed — these events
// carry real client PII (names, phones, addresses; a job's title IS the
// client's address), and Google's embed only works on a calendar set to
// "public" (anyone with the link, no login). This route instead fetches
// events server-side through the existing Google service account
// (src/lib/google-calendar.ts) and renders them here, behind the same
// login every other page in this CRM requires.
export default async function CalendarPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "scheduler:view")) redirect("/access-denied")

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Calendar" subtitle="Jobs, lead appointments, and meta-lead calls" />
      <CalendarAgenda />
    </div>
  )
}
