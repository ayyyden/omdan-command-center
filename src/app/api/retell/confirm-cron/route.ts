import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import {
  getConfirmation, ptParts, leadBrand, confirmationText, textCustomer, notifyOwner, BRANDS,
} from "@/lib/appointments"
import { calendarAppointments } from "@/lib/calendar-appointments"
import { speakDateTime } from "@/lib/retell"
import { isRealUsPhone } from "@/lib/quo-client"
import { sendDailyCheckin } from "@/lib/lead-checkins"
import { runFollowups } from "@/lib/followups"
import { retryMissingAppointmentEvents } from "@/lib/lead-appointment-calendar-sync"

// POST /api/retell/confirm-cron
// Runs every 5 minutes (booking backend Apps Script trigger runConfirmations).
// Appointment confirmations are by TEXT ONLY — no calls. For every estimate on
// the Google Calendar in the next ~36 hours (jobs, all-day events and events
// without a phone are skipped):
//   24 hours before          -> confirmation text from the company's number:
//                               reply YES to confirm, 2 for a different time
//                               (replies are handled in /api/quo/inbound)
//   no reply 2 hours before  -> the owner gets a heads-up to call them
// Bookings made after the text time count as confirmed (they just booked and
// got a booking text), and so do appointments already marked confirmed on the
// calendar. Texts only go out between 8 AM and 8 PM Pacific.
//
// Auth: x-website-secret = WEBSITE_LEADS_SECRET (the booking backend's key).
// ?dry=1 reports what it would do without texting anyone.
// Same 5-minute tick also sends Lia's 8 PM "How did today go?" check-in and the
// follow-up texts that are due.

const MIN = 60_000

export async function POST(req: NextRequest) {
  const expected = process.env.WEBSITE_LEADS_SECRET
  const secret = req.headers.get("x-website-secret")
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const dry = new URL(req.url).searchParams.get("dry") === "1"

  const service = createServiceClient()
  const now = new Date()

  // Evening check-in and follow-up texts ride the same tick; neither blocks the confirmations.
  const extras = dry ? null : await Promise.all([
    sendDailyCheckin(service, now).catch((err) => ({ sent: false, reason: String(err) })),
    runFollowups(service, now).catch((err) => ({ sent: 0, error: String(err) })),
    retryMissingAppointmentEvents().catch((err) => [{ id: "-", ok: false, error: String(err) }]),
  ])

  // Who to text comes from the Google Calendar (see calendar-appointments.ts).
  // Syncs two weeks ahead so Sofia also recognises these customers when they call in;
  // confirmations only look at the next 36 hours.
  let calendar: Awaited<ReturnType<typeof calendarAppointments>>
  try {
    calendar = await calendarAppointments(service, 14 * 24, { dry })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[confirm-cron] calendar read failed:", message)
    return NextResponse.json({ error: `Couldn't read the calendar: ${message}` }, { status: 502 })
  }

  const nowPt = ptParts(now.toISOString())
  const minutesPt = Number(nowPt.time.slice(0, 2)) * 60 + Number(nowPt.time.slice(3))
  const textHours = minutesPt >= 8 * 60 && minutesPt <= 20 * 60

  const report: Record<string, unknown>[] = []
  const horizon = now.getTime() + 36 * 60 * MIN
  for (const { lead, bookedAt, calendarConfirmed } of calendar.appointments) {
    if (new Date(lead.scheduled_at!).getTime() > horizon) continue
    if (!lead.phone || !lead.scheduled_at) continue
    const start = new Date(lead.scheduled_at)
    const textDue = new Date(start.getTime() - 24 * 60 * MIN)
    const headsUpDue = new Date(start.getTime() - 120 * MIN)
    const entry: Record<string, unknown> = { lead: lead.full_name, brand: leadBrand(lead), at: lead.scheduled_at, textDue: textDue.toISOString() }
    report.push(entry)

    const row = dry ? null : await getConfirmation(service, lead)
    if (!dry && !row) { entry.action = "no tracking row"; continue }
    if (row && row.status !== "pending") { entry.action = `skip (${row.status})`; continue }

    // Already marked confirmed on the calendar: nothing to ask.
    if (calendarConfirmed) {
      entry.action = "confirmed on the calendar"
      if (row) await service.from("appointment_confirmations")
        .update({ status: "confirmed", confirmed_at: now.toISOString(), confirmed_via: "calendar" }).eq("id", row.id)
      continue
    }

    // Booked after the text time: they just booked (and got a booking text).
    if (!row?.text_sent_at && new Date(bookedAt) > new Date(textDue.getTime() - 60 * MIN)) {
      entry.action = "booked recently, counted as confirmed"
      if (row) await service.from("appointment_confirmations")
        .update({ status: "confirmed", confirmed_at: now.toISOString(), confirmed_via: "booked recently" }).eq("id", row.id)
      continue
    }

    // The confirmation text.
    if (!row?.text_sent_at && now >= textDue && now < headsUpDue) {
      if (!textHours) { entry.action = "text waiting for 8 AM"; continue }
      entry.action = "confirmation text"
      if (!isRealUsPhone(lead.phone)) { entry.action = "skip (not a real phone number)"; continue }
      if (row) {
        const sms = await textCustomer(lead, lead.phone, confirmationText(lead))
        // A failed text is tried once only (text_sent_at is set either way), so
        // the owner gets one message about it, not one every 5 minutes.
        await service.from("appointment_confirmations")
          .update(sms.ok ? { text_sent_at: now.toISOString() } : { text_sent_at: now.toISOString(), notes: `Confirmation text failed: ${sms.error}`.slice(0, 500) }).eq("id", row.id)
        if (!sms.ok) await notifyOwner(`Couldn't text ${lead.full_name} (${lead.phone}) the confirmation request: ${sms.error.slice(0, 160)}`)
        entry.result = sms.ok ? "sent" : sms.error
      }
      continue
    }

    // No reply: heads-up to the owner, once (final_call_at marks that it was sent).
    if (row?.text_sent_at && !row.final_call_at && now >= headsUpDue && now < start) {
      entry.action = "owner heads-up (no reply)"
      await service.from("appointment_confirmations")
        .update({ final_call_at: now.toISOString(), final_call_result: "owner heads-up: no reply to the confirmation text" }).eq("id", row.id)
      await notifyOwner(`Heads-up: ${lead.full_name} (${BRANDS[leadBrand(lead)].name}) has NOT replied to the confirmation text for their ${speakDateTime(lead.scheduled_at)} estimate. Please call them: ${lead.phone}`)
      continue
    }
    entry.action = "waiting"
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), textHours, dry, appointments: report, skipped: calendar.skipped, checkin: extras?.[0], followups: extras?.[1], calendarRetries: extras?.[2] })
}
