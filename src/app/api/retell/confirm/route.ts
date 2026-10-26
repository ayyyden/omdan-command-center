import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, phoneDigits, speakDateTime } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { setEventConfirmed } from "@/lib/google-calendar"

// POST /api/retell/confirm — Retell tool "confirm_appointment".
// The caller confirmed their upcoming estimate: mark the calendar event
// confirmed (turns it green, same as the Confirm button in the scheduler) and
// note it on the lead. Only works for the caller's own appointment.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{ appointment_ref?: string; language?: "en" | "es" }>(req)
  const lang = args.language === "es" ? "es" : "en"
  if (!args.appointment_ref) return toolReply({ ok: false, message: "Call lookup_caller first to find their appointment." })

  const service = createServiceClient()
  const { data: lead } = await service
    .from("meta_leads")
    .select("id, phone, scheduled_at, calendar_event_id, calendar_id, notes")
    .eq("id", args.appointment_ref)
    .maybeSingle()
  if (!lead || !lead.scheduled_at) return toolReply({ ok: false, message: "Appointment not found. Tell them David will confirm by text." })
  if (call.from_number && phoneDigits(lead.phone) !== phoneDigits(call.from_number)) {
    return toolReply({ ok: false, message: "That appointment isn't under this caller's number. Don't share details; offer a callback from David." })
  }

  const calendarId = lead.calendar_id || process.env.META_LEADS_MAIN_CALENDAR_ID
  if (lead.calendar_event_id && calendarId) {
    try {
      await setEventConfirmed(calendarId, lead.calendar_event_id, true)
    } catch (err) {
      console.error("[retell/confirm] calendar confirm failed:", err)
    }
  }
  const stamp = new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  await service.from("meta_leads")
    .update({ notes: [lead.notes, `Confirmed by phone (AI receptionist) ${stamp}`].filter(Boolean).join("\n") })
    .eq("id", lead.id)

  return toolReply({ ok: true, message: `Confirmed for ${speakDateTime(lead.scheduled_at, lang)}.` })
}
