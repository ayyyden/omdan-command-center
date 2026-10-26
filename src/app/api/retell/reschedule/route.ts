import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, customerNumber } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { findCallerAppointment, rescheduleLead } from "@/lib/appointments"

// POST /api/retell/reschedule — Retell tool "reschedule_appointment".
// Moves the caller's estimate to a new open time (from check_availability):
// calendar event, booking sheet and CRM card all move; the caller gets a
// text with the new time and David gets a heads-up.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{ appointment_ref?: string; new_date?: string; new_time?: string; language?: "en" | "es" }>(req)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.new_date ?? "") || !/^\d{2}:\d{2}$/.test(args.new_time ?? "")) {
    return toolReply({ ok: false, message: "Pick a new time from check_availability first, and pass its exact date and time values." })
  }
  const service = createServiceClient()
  const found = await findCallerAppointment(service, args.appointment_ref, customerNumber(call))
  if ("error" in found) return toolReply({ ok: false, message: found.error })

  const result = await rescheduleLead(service, found.lead, args.new_date!, args.new_time!, args.language === "es" ? "es" : "en")
  return toolReply(result)
}
