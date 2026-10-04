import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

// POST /api/meta-leads/website
// Called by the desertgreenbuilders.com booking backend (Google Apps Script)
// after a visitor books a free estimate. Unlike /ingest (which drops a lead on
// the call list), these people already picked a time, so the card goes
// straight to "scheduled" with the appointment time. The website already put
// the event on the main Meta-leads calendar (same Google account), so this
// route only records its id — it never creates or touches calendar events.
//
// Auth: x-website-secret must equal WEBSITE_LEADS_SECRET. Kept separate from
// ASSISTANT_SECRET on purpose so the website's key can only create leads.
export async function POST(req: NextRequest) {
  const expected = process.env.WEBSITE_LEADS_SECRET
  const secret = req.headers.get("x-website-secret")
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json().catch(() => ({})) as {
    booking_id?:        string
    full_name?:         string
    phone?:             string | null
    address?:           string | null
    city?:              string | null
    scheduled_at?:      string | null
    calendar_event_id?: string | null
    homeowner?:         string | null
    yard?:              string | null
    interests?:         string | null
    language?:          string | null
    phone_verified?:    boolean
  }

  const full_name = body.full_name?.trim()
  const booking_id = body.booking_id?.trim()
  if (!full_name || !booking_id) {
    return NextResponse.json({ error: "full_name and booking_id are required" }, { status: 400 })
  }
  const when = body.scheduled_at ? new Date(body.scheduled_at) : null
  if (!when || Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "scheduled_at must be a valid date" }, { status: 400 })
  }

  const service = createServiceClient()
  const ref = `Website booking ${booking_id}`

  // The Apps Script retries on network errors, so the same booking can arrive twice.
  const { data: existing } = await service
    .from("meta_leads")
    .select("id")
    .eq("raw_paste", ref)
    .limit(1)
  if (existing?.length) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate", lead_id: existing[0].id })
  }

  const notes = [
    "Source: Website (desertgreenbuilders.com)",
    body.homeowner ? `Homeowner: ${body.homeowner}` : null,
    body.yard ? `Yard: ${body.yard}` : null,
    body.interests ? `Interested in: ${body.interests}` : null,
    body.language ? `Language: ${body.language}` : null,
    body.phone_verified ? "Phone verified by text code" : null,
  ].filter(Boolean).join("\n")

  const { data, error } = await service
    .from("meta_leads")
    .insert({
      full_name,
      phone:             body.phone?.trim() || null,
      address:           body.address?.trim() || null,
      city:              body.city?.trim() || null,
      raw_paste:         ref,
      notes,
      list:              "scheduled",
      last_outcome:      "answered_scheduled",
      scheduled_at:      when.toISOString(),
      calendar_event_id: body.calendar_event_id?.trim() || null,
      calendar_id:       body.calendar_event_id ? process.env.META_LEADS_MAIN_CALENDAR_ID ?? null : null,
    })
    .select("id, full_name")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lead: data }, { status: 201 })
}
