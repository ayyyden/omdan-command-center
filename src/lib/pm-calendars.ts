// Which Google Calendar an estimate lives on, by who goes to it.
//   David (main_calendar) or nobody picked -> the main calendar. That's the
//     calendar the website booking system reads, so it decides David's open times.
//   any other project manager -> his own calendar, created here the first time
//     he's given an estimate and shared with the main account (and him).
// Moving an estimate to another salesman moves its event to his calendar, which
// opens David's time on the website and in Add lead (migration 068).

import type { SupabaseClient } from "@supabase/supabase-js"
import { createCalendar, shareCalendar } from "@/lib/google-calendar"

export interface Pm {
  id:          string
  name:        string
  email:       string | null
  calendarId:  string | null   // his own calendar (null until first needed, or for David)
  main:        boolean         // goes on the main calendar (David)
}

export function mainCalendarId(): string {
  const id = process.env.META_LEADS_MAIN_CALENDAR_ID
  if (!id) throw new Error("Calendar not configured (META_LEADS_MAIN_CALENDAR_ID)")
  return id
}

/** "david celuk" -> "David" (the name customers see in texts). */
export function pmFirstName(name: string | null | undefined): string {
  const first = String(name ?? "").trim().split(/\s+/)[0] ?? ""
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : "David"
}

/** Active project managers. Before migration 068 everyone counts as "main"
 *  (today's behaviour: one calendar for all). */
export async function loadPms(service: SupabaseClient): Promise<Pm[]> {
  const res = await service.from("project_managers").select("id, name, email, is_active, is_archived, calendar_id, main_calendar")
  if (res.error) {
    const old = await service.from("project_managers").select("id, name, email, is_active, is_archived")
    return (old.data ?? []).filter((p) => p.is_active !== false && !p.is_archived)
      .map((p) => ({ id: p.id, name: p.name, email: p.email ?? null, calendarId: null, main: true }))
  }
  return (res.data ?? []).filter((p) => p.is_active !== false && !p.is_archived)
    .map((p) => ({ id: p.id, name: p.name, email: p.email ?? null, calendarId: p.calendar_id ?? null, main: !!p.main_calendar }))
}

/** The salesman whose estimates live on the main calendar (David). */
export function mainPm(pms: Pm[]): Pm | null {
  return pms.find((p) => p.main) ?? null
}

/** The calendar for a project manager's estimates; creates his calendar the
 *  first time. Nobody / unknown / David -> the main calendar. */
export async function calendarForPm(service: SupabaseClient, pmId: string | null | undefined): Promise<string> {
  const main = mainCalendarId()
  if (!pmId) return main
  const pm = (await loadPms(service)).find((p) => p.id === pmId)
  if (!pm || pm.main) return main
  if (pm.calendarId) return pm.calendarId

  const calendarId = await createCalendar(`Estimates – ${pm.name}`)
  // The company account sees (and can edit) it in Google Calendar; so does he.
  try { await shareCalendar(calendarId, main, "owner") }
  catch (err) { console.error("[pm-calendars] sharing with the main account failed:", err) }
  if (pm.email && /@/.test(pm.email) && !/@(test|example)\./i.test(pm.email)) {
    try { await shareCalendar(calendarId, pm.email, "writer") }
    catch (err) { console.error("[pm-calendars] sharing with the salesman failed:", err) }
  }
  const { error } = await service.from("project_managers").update({ calendar_id: calendarId }).eq("id", pm.id)
  if (error) throw new Error(`Couldn't save ${pm.name}'s calendar: ${error.message}`)
  return calendarId
}

/** Every calendar estimates live on: main (David) plus each salesman's. */
export async function estimateCalendars(service: SupabaseClient): Promise<{ calendarId: string; pm: Pm | null }[]> {
  const pms = await loadPms(service)
  const main = mainCalendarId()
  return [
    { calendarId: main, pm: mainPm(pms) },
    ...pms.filter((p) => !p.main && p.calendarId && p.calendarId !== main).map((p) => ({ calendarId: p.calendarId!, pm: p })),
  ]
}

/** The calendar a Scheduler-page event is on: the callback calendar, a
 *  salesman's own calendar (pm_id), or the main one. Never takes a raw id from
 *  the browser, so only the CRM's own calendars can be touched. */
export async function calendarOfEvent(service: SupabaseClient, which: "main" | "callback", pmId: string | null | undefined): Promise<string | null> {
  if (which === "callback") return process.env.META_LEADS_CALLBACK_CALENDAR_ID ?? null
  if (pmId) {
    const pm = (await loadPms(service)).find((p) => p.id === pmId)
    if (pm && !pm.main && pm.calendarId) return pm.calendarId
  }
  return process.env.META_LEADS_MAIN_CALENDAR_ID ?? null
}
