import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, sayWhenIso, customerNumber } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { findCallerAppointment, markConfirmed } from "@/lib/appointments"

// POST /api/retell/confirm — Retell tool "confirm_appointment".
// The caller confirmed their upcoming estimate: mark the calendar event
// confirmed (turns it green, same as the Confirm button in the scheduler),
// stop the confirmation calls/texts, and note it on the lead. Only works for
// the caller's own appointment.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{ appointment_ref?: string; language?: "en" | "es" }>(req)
  const service = createServiceClient()
  const found = await findCallerAppointment(service, args.appointment_ref, customerNumber(call))
  if ("error" in found) return toolReply({ ok: false, message: found.error })

  await markConfirmed(service, found.lead, call.direction === "outbound" ? "confirmation call" : "phone call")
  return toolReply({ ok: true, message: `Confirmed for ${sayWhenIso(found.lead.scheduled_at!, args.language === "es" ? "es" : "en")}.` })
}
