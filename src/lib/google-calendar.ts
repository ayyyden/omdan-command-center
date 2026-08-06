// Google Calendar integration for Meta Lead Jobs.
// Uses a Google Service Account (no OAuth consent flow / token storage needed) —
// the two target calendars must be shared with the service account's email
// address ("Make changes to events" permission). See the Meta Lead Jobs plan
// for the one-time Google Cloud Console setup steps.

import { google } from "googleapis"

const EVENT_DURATION_MINUTES = 30

export interface MetaLeadCalendarInfo {
  full_name: string
  phone?:    string | null
  email?:    string | null
  city?:     string | null
  address?:  string | null
}

function getServiceAccountAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL
  const key   = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY

  if (!email || !key) {
    throw new Error(
      "Google Calendar is not configured — set GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
    )
  }

  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/calendar"],
  })
}

function getCalendarClient() {
  return google.calendar({ version: "v3", auth: getServiceAccountAuth() })
}

/**
 * Creates a 30-minute event on the given calendar for the given lead at whenISO.
 * Throws on any failure — callers should NOT update the DB row until this resolves.
 */
export async function createCalendarEvent(
  calendarId: string,
  lead: MetaLeadCalendarInfo,
  whenISO: string,
): Promise<{ eventId: string }> {
  const start = new Date(whenISO)
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid scheduled_at value: ${whenISO}`)
  }
  const end = new Date(start.getTime() + EVENT_DURATION_MINUTES * 60 * 1000)

  const calendar = getCalendarClient()

  const description = [
    lead.phone   ? `Phone: ${lead.phone}`     : null,
    lead.email   ? `Email: ${lead.email}`     : null,
    lead.city    ? `City: ${lead.city}`       : null,
    lead.address ? `Address: ${lead.address}` : null,
  ].filter(Boolean).join("\n")

  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: `Call: ${lead.full_name}`,
      description: description || undefined,
      start: { dateTime: start.toISOString(), timeZone: "America/Los_Angeles" },
      end:   { dateTime: end.toISOString(),   timeZone: "America/Los_Angeles" },
    },
  })

  if (!data.id) throw new Error("Google Calendar did not return an event id")

  return { eventId: data.id }
}
