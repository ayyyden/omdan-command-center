import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, customerNumber } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { findCallerAppointment, cancelLead } from "@/lib/appointments"

// POST /api/retell/cancel — Retell tool "cancel_appointment".
// Only after the agent offered to reschedule and the caller still wants to
// cancel (the prompt enforces that). Frees the time on the calendar and the
// booking sheet, puts the card back on the call list and texts David.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{ appointment_ref?: string; reason?: string; offered_reschedule?: boolean }>(req)
  if (args.offered_reschedule !== true) {
    return toolReply({ ok: false, message: "Before cancelling, offer to move it to another day: check availability and offer two times." })
  }
  const service = createServiceClient()
  const found = await findCallerAppointment(service, args.appointment_ref, customerNumber(call))
  if ("error" in found) return toolReply({ ok: false, message: found.error })

  await cancelLead(service, found.lead, (args.reason ?? "").slice(0, 300))
  return toolReply({ ok: true, message: "Cancelled. Let them know they can call or text anytime to book again." })
}
