import { getSessionMember } from "@/lib/auth-helpers"
import { Topbar } from "@/components/shared/topbar"

export const dynamic = "force-dynamic"

// Replaces the old internal day-by-day scheduler with the real Google
// Calendar, embedded directly — jobs, lead appointments, meta-lead calls,
// and reminders all sync there now (see job-calendar-sync.ts,
// lead-appointment-calendar-sync.ts, meta-leads outcome route, and Lia's
// create_reminder), so this one view is the actual source of truth instead
// of a second, easy-to-drift copy of the same data.
//
// Requires the calendar(s) to be shared publicly ("make available to
// public" in Google Calendar's own sharing settings) — Google's embed
// iframe only renders a calendar that's set to public, there's no
// authenticated-embed option for a plain iframe like this.
export default async function CalendarPage() {
  const session = await getSessionMember()
  if (!session) return null

  const mainCalendarId     = process.env.META_LEADS_MAIN_CALENDAR_ID
  const callbackCalendarId = process.env.META_LEADS_CALLBACK_CALENDAR_ID

  const calendarIds = [mainCalendarId, callbackCalendarId].filter((id): id is string => !!id)

  if (!calendarIds.length) {
    return (
      <div className="flex flex-col h-full">
        <Topbar title="Calendar" subtitle="Google Calendar" />
        <div className="flex-1 flex items-center justify-center p-6">
          <p className="text-sm text-muted-foreground max-w-md text-center">
            No calendar is configured yet — set META_LEADS_MAIN_CALENDAR_ID
            (and optionally META_LEADS_CALLBACK_CALENDAR_ID) in Vercel's
            environment variables.
          </p>
        </div>
      </div>
    )
  }

  const params = new URLSearchParams({
    ctz:           "America/Los_Angeles",
    mode:          "WEEK",
    showTitle:     "0",
    showNav:       "1",
    showDate:      "1",
    showTabs:      "1",
    showCalendars: "1",
    showTz:        "0",
    showPrint:     "0",
  })
  for (const id of calendarIds) params.append("src", id)
  const embedUrl = `https://calendar.google.com/calendar/embed?${params.toString()}`

  return (
    <div className="flex flex-col h-full">
      <Topbar title="Calendar" subtitle="Jobs, lead appointments, and meta-lead calls" />
      <div className="flex-1 p-4 sm:p-6">
        <iframe
          src={embedUrl}
          className="w-full h-full rounded-lg border"
          style={{ minHeight: "600px" }}
          title="Company Calendar"
        />
      </div>
    </div>
  )
}
