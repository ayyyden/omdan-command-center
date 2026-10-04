import Link from "next/link"
import { OmdanMark } from "@/components/brand/omdan-mark"

// Studio-design dashboard opener: greeting, a one-sentence read of the day,
// and the month's money on a brass ground line — beside the tower mark,
// which draws itself once on load.

interface Figure { label: string; value: string; href?: string; negative?: boolean }

interface Props {
  firstName: string | null
  figures: Figure[]
  counts: {
    todayJobs: number
    overdueJobs: number
    waitingEstimates: number
    overdueEstimates: number
    newLeads: number
    followUps: number
    overdueReminders: number
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

function laHour(): number {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Los_Angeles" }).format(new Date()))
}

function summary(c: Props["counts"]): string {
  const parts: string[] = []
  parts.push(c.todayJobs ? `${plural(c.todayJobs, "job", "jobs")} on the schedule today` : "No jobs on the schedule today")
  const attention: string[] = []
  if (c.overdueJobs) attention.push(`${plural(c.overdueJobs, "job is", "jobs are")} past their date`)
  if (c.overdueEstimates) attention.push(`${plural(c.overdueEstimates, "estimate has", "estimates have")} gone 3+ days without a reply`)
  else if (c.waitingEstimates) attention.push(`${plural(c.waitingEstimates, "estimate is", "estimates are")} waiting on a reply`)
  if (c.newLeads) attention.push(`${plural(c.newLeads, "new lead needs", "new leads need")} a call`)
  if (c.overdueReminders) attention.push(`${plural(c.overdueReminders, "reminder is", "reminders are")} overdue`)

  if (!attention.length) return `${parts[0]}, and nothing is waiting on you.`
  const list = attention.length === 1
    ? attention[0]
    : `${attention.slice(0, -1).join(", ")} and ${attention[attention.length - 1]}`
  return `${parts[0]}. ${list.charAt(0).toUpperCase()}${list.slice(1)}.`
}

export function StudioDashboardHero({ firstName, figures, counts }: Props) {
  const h = laHour()
  const greeting = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/Los_Angeles" }).format(new Date())

  return (
    <section className="studio-hero" aria-label="Today at a glance">
      <OmdanMark id="hero" animated strokeWidth={1.6} className="hero-mark" title="" />
      <p className="text-[13px] text-[#DDBE6C]/85">{today}</p>
      <h1 className="hero-greeting mt-1.5">{greeting}{firstName ? `, ${firstName}` : ""}</h1>
      <p className="hero-summary">{summary(counts)}</p>
      {figures.length > 0 && (
        <div className="hero-ledger">
          {figures.map((f) => {
            const body = (
              <>
                <span className="fig-label">{f.label}</span>
                <span className="fig-value">{f.value}</span>
              </>
            )
            return (
              <div key={f.label} className={f.negative ? "is-negative" : undefined}>
                {f.href ? <Link href={f.href}>{body}</Link> : body}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
