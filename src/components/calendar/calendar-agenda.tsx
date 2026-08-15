"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MapPin, ExternalLink, RefreshCw, CalendarDays } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface CalendarEvent {
  id:          string
  title:       string
  start:       string | null
  end:         string | null
  location:    string | null
  description: string | null
  htmlLink:    string | null
  calendar:    "main" | "callback"
}

const CALENDAR_BADGE: Record<CalendarEvent["calendar"], { label: string; className: string }> = {
  main:     { label: "Appointment", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  callback: { label: "Callback",    className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
}

function dayLabel(dateStr: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const d = new Date(dateStr + "T00:00:00")
  if (d.getTime() === today.getTime()) return "Today"
  if (d.getTime() === tomorrow.getTime()) return "Tomorrow"
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function timeLabel(start: string | null, end: string | null): string {
  if (!start) return ""
  if (!start.includes("T")) return "All day" // date-only = all-day event
  const s = new Date(start).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (!end || !end.includes("T")) return s
  const e = new Date(end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return `${s} – ${e}`
}

export function CalendarAgenda() {
  const [events, setEvents]   = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [configured, setConfigured] = useState<{ main: boolean; callback: boolean }>({ main: true, callback: true })
  const [daysAhead, setDaysAhead] = useState(30)

  const load = useCallback(async (days: number) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/calendar/events?days_ahead=${days}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to load calendar")
      setEvents(data.events ?? [])
      setConfigured(data.configured ?? { main: true, callback: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load calendar")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(daysAhead) }, [load, daysAhead])

  if (!configured.main && !configured.callback) {
    return (
      <div className="flex items-center justify-center h-full p-6">
        <p className="text-sm text-muted-foreground max-w-md text-center">
          No calendar is configured yet — set META_LEADS_MAIN_CALENDAR_ID
          (and optionally META_LEADS_CALLBACK_CALENDAR_ID) in Vercel&apos;s environment variables.
        </p>
      </div>
    )
  }

  const groups = new Map<string, CalendarEvent[]>()
  for (const e of events) {
    const date = e.start ? e.start.slice(0, 10) : "unknown"
    if (!groups.has(date)) groups.set(date, [])
    groups.get(date)!.push(e)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-border shrink-0">
        <div className="flex gap-1">
          {[7, 30, 60].map((d) => (
            <Button key={d} variant={daysAhead === d ? "default" : "outline"} size="sm" onClick={() => setDaysAhead(d)}>
              {d === 7 ? "1 week" : d === 30 ? "30 days" : "60 days"}
            </Button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => load(daysAhead)} disabled={loading}>
          <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {loading && events.length === 0 && (
          <div className="flex items-center justify-center gap-2 text-muted-foreground py-16">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {!loading && !error && groups.size === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground py-16 text-center">
            <CalendarDays className="w-8 h-8 opacity-40" />
            <p>Nothing on the calendar in this window.</p>
          </div>
        )}

        {Array.from(groups.entries()).map(([date, dayEvents]) => (
          <div key={date}>
            <h3 className="text-sm font-semibold text-foreground mb-2">
              {date === "unknown" ? "Unscheduled" : dayLabel(date)}
            </h3>
            <div className="space-y-2">
              {dayEvents.map((e) => (
                <div key={e.id} className="rounded-lg border bg-card p-3 flex items-start gap-3">
                  <div className="w-20 shrink-0 text-xs text-muted-foreground pt-0.5">
                    {timeLabel(e.start, e.end)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{e.title}</span>
                      <Badge className={cn("text-[10px]", CALENDAR_BADGE[e.calendar].className)}>
                        {CALENDAR_BADGE[e.calendar].label}
                      </Badge>
                    </div>
                    {e.location && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{e.location}</span>
                      </div>
                    )}
                  </div>
                  {e.htmlLink && (
                    <a
                      href={e.htmlLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open in Google Calendar"
                      className="text-muted-foreground hover:text-primary shrink-0"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
