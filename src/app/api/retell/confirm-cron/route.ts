import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import {
  LEAD_COLUMNS, getConfirmation, ptParts, ptInstant, startConfirmationCall, processConfirmationCall,
  leadBrand, type ScheduledLead, type ConfirmationRow,
} from "@/lib/appointments"
import type { RetellCall } from "@/lib/retell"

// POST /api/retell/confirm-cron
// Runs every 5 minutes (booking backend Apps Script trigger runConfirmations).
// For every scheduled estimate in the next ~36 hours:
//   before 12 PM  -> confirmation call the day before at 6 PM
//   12 PM onward  -> confirmation call the same day at 10 AM
//   no answer / no decision -> confirmation text (processConfirmationCall)
//   still not confirmed -> last call 30 minutes before; if that fails, David gets a heads-up text
// Bookings made after the confirmation-call time count as confirmed (they just booked).
// Calls only go out between 7:30 AM and 8:30 PM Pacific.
//
// Auth: x-website-secret = WEBSITE_LEADS_SECRET (the booking backend's key).
// ?dry=1 reports what it would do without calling anyone.

const MIN = 60_000

export async function POST(req: NextRequest) {
  const expected = process.env.WEBSITE_LEADS_SECRET
  const secret = req.headers.get("x-website-secret")
  if (!expected || !secret || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const params = new URL(req.url).searchParams
  const dry = params.get("dry") === "1"

  const service = createServiceClient()
  const now = new Date()

  // Testing: ?force=<meta lead id>&kind=first|final|reschedule_request places that call right now.
  const force = params.get("force")
  if (force) {
    const { data: lead } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", force).maybeSingle()
    if (!lead?.scheduled_at) return NextResponse.json({ error: "lead not found or not scheduled" }, { status: 404 })
    const row = await getConfirmation(service, lead as ScheduledLead)
    if (!row) return NextResponse.json({ error: "no tracking row (is migration 064 applied?)" }, { status: 500 })
    const kind = params.get("kind") === "final" ? "final" : params.get("kind") === "reschedule_request" ? "reschedule_request" : "first"
    const call = await startConfirmationCall(lead as ScheduledLead, row, kind)
    if (call.ok && kind !== "reschedule_request") {
      await service.from("appointment_confirmations").update(kind === "final"
        ? { final_call_at: now.toISOString(), final_call_id: call.call_id, final_call_result: null }
        : { first_call_at: now.toISOString(), first_call_id: call.call_id, first_call_result: null }).eq("id", row.id)
    }
    return NextResponse.json({ ok: call.ok, call })
  }
  const { data, error } = await service.from("meta_leads")
    .select(LEAD_COLUMNS)
    .eq("list", "scheduled")
    .gt("scheduled_at", now.toISOString())
    .lt("scheduled_at", new Date(now.getTime() + 36 * 60 * MIN).toISOString())
    .order("scheduled_at")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const nowPt = ptParts(now.toISOString())
  const minutesPt = Number(nowPt.time.slice(0, 2)) * 60 + Number(nowPt.time.slice(3))
  const callHours = minutesPt >= 7 * 60 + 30 && minutesPt <= 20 * 60 + 30

  const report: Record<string, unknown>[] = []
  for (const lead of (data ?? []) as ScheduledLead[]) {
    if (!lead.phone || !lead.scheduled_at) continue
    const start = new Date(lead.scheduled_at)
    const { date, hour } = ptParts(lead.scheduled_at)
    const morning = hour < 12
    const dayBefore = ptParts(new Date(ptInstant(date, "12:00").getTime() - 24 * 60 * MIN).toISOString()).date
    const firstDue = morning ? ptInstant(dayBefore, "18:00") : ptInstant(date, "10:00")
    const finalDue = new Date(start.getTime() - 30 * MIN)
    const entry: Record<string, unknown> = { lead: lead.full_name, brand: leadBrand(lead), at: lead.scheduled_at, firstDue: firstDue.toISOString() }
    report.push(entry)

    const row = dry ? null : await getConfirmation(service, lead)
    if (!dry && !row) { entry.action = "no tracking row"; continue }
    if (row && row.status !== "pending") { entry.action = `skip (${row.status})`; continue }

    // Booked after the confirmation-call time: they just booked, no need to confirm.
    if (new Date(lead.created_at) > new Date(firstDue.getTime() - 60 * MIN)) {
      entry.action = "booked recently, counted as confirmed"
      if (row) await service.from("appointment_confirmations")
        .update({ status: "confirmed", confirmed_at: now.toISOString(), confirmed_via: "booked recently" }).eq("id", row.id)
      continue
    }

    // Catch up on a call result the webhook never delivered.
    if (row) {
      const status = await catchUpCallResults(service, row, now)
      if (status !== "pending") { entry.action = `skip (${status})`; continue }
    }

    if (!row?.first_call_at && now >= firstDue && now < new Date(finalDue.getTime() - 15 * MIN)) {
      if (!callHours) { entry.action = "first call waiting for call hours"; continue }
      entry.action = "first call"
      if (row) {
        const call = await startConfirmationCall(lead, row, "first")
        await service.from("appointment_confirmations").update({
          first_call_at: now.toISOString(), first_call_id: call.ok ? call.call_id : null,
          first_call_result: call.ok ? null : `failed: ${call.error}`,
        }).eq("id", row.id)
        entry.result = call
      }
      continue
    }

    if (!row?.final_call_at && now >= finalDue && now < new Date(start.getTime() - 10 * MIN)) {
      if (!callHours) { entry.action = "final call outside call hours"; continue }
      entry.action = "final call"
      if (row) {
        const call = await startConfirmationCall(lead, row, "final")
        await service.from("appointment_confirmations").update({
          final_call_at: now.toISOString(), final_call_id: call.ok ? call.call_id : null,
          final_call_result: call.ok ? null : `failed: ${call.error}`,
        }).eq("id", row.id)
        entry.result = call
      }
      continue
    }
    entry.action = "waiting"
  }

  return NextResponse.json({ ok: true, now: now.toISOString(), callHours, dry, appointments: report })
}

/** If a call ended over 10 minutes ago and we never got its result, fetch it from Retell. */
async function catchUpCallResults(service: ReturnType<typeof createServiceClient>, row: ConfirmationRow, now: Date): Promise<ConfirmationRow["status"]> {
  const pending: [string | null, string | null, string | null][] = [
    [row.first_call_id, row.first_call_at, row.first_call_result],
    [row.final_call_id, row.final_call_at, row.final_call_result],
  ]
  for (const [callId, at, result] of pending) {
    if (!callId || result || !at || now.getTime() - new Date(at).getTime() < 10 * MIN) continue
    try {
      const res = await fetch(`https://api.retellai.com/v2/get-call/${callId}`, {
        headers: { Authorization: `Bearer ${process.env.RETELL_API_KEY}` },
      })
      const call = await res.json() as RetellCall
      if (call.call_status === "ended" || call.call_status === "error" || call.call_status === "not_connected") {
        await processConfirmationCall(service, call)
        Object.assign(row, (await service.from("appointment_confirmations").select("*").eq("id", row.id).single()).data)
      }
    } catch (err) {
      console.error("[confirm-cron] catch-up failed:", err)
    }
  }
  return row.status
}
