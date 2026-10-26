import { NextRequest, NextResponse } from "next/server"
import { verifyRetellSecret, phoneDigits, TZ, type RetellCall } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"
import { sendQuoSms } from "@/lib/quo-client"
import { createTransporter, buildHtmlEmail } from "@/lib/email"

// POST /api/retell/webhook?secret=… — Retell agent webhook.
// On "call_analyzed" (after every call, once Retell has the summary):
//   1. notes the call on the caller's Meta lead, or adds them to the call list
//      if they're a new lead who didn't book,
//   2. texts David a one-line summary (OWNER_CELL),
//   3. emails the full transcript (ASSISTANT_OWNER_EMAIL).
// Bookings themselves arrive separately through the booking backend.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as { event?: string; call?: RetellCall }
  if (body.event !== "call_analyzed" || !body.call?.call_id) return NextResponse.json({ ok: true, skipped: true })

  const call = body.call
  const callId = call.call_id!
  const a = (call.call_analysis?.custom_analysis_data ?? {}) as {
    caller_name?:        string
    project?:            string
    city_or_zip?:        string
    appointment_booked?: boolean
    needs_callback?:     boolean
    action_for_owner?:   string
    language?:           string
  }
  const summary = call.call_analysis?.call_summary?.trim() || "(no summary)"
  if (!call.transcript?.trim()) return NextResponse.json({ ok: true, skipped: true, reason: "empty call" })

  const phone = call.from_number ?? null
  const digits = phoneDigits(phone)
  const marker = `[AI call ${callId}]`
  const stamp = new Date(call.start_timestamp ?? Date.now()).toLocaleString("en-US", { timeZone: TZ })
  const noteLine = `${marker} ${stamp}: ${summary}${a.action_for_owner ? `\nTo do: ${a.action_for_owner}` : ""}`

  const service = createServiceClient()
  let leadId: string | null = null
  let leadAction: "noted" | "created" | "none" | "duplicate" = "none"

  if (digits.length === 10) {
    const { data } = await service.from("meta_leads")
      .select("id, phone, notes").ilike("phone", `%${digits.slice(-4)}%`)
      .order("created_at", { ascending: false }).limit(20)
    const lead = (data ?? []).find((l) => phoneDigits(l.phone) === digits)
    if (lead?.notes?.includes(marker)) {
      leadAction = "duplicate"
    } else if (lead) {
      await service.from("meta_leads").update({ notes: [lead.notes, noteLine].filter(Boolean).join("\n\n") }).eq("id", lead.id)
      leadId = lead.id
      leadAction = "noted"
    } else if (!a.appointment_booked && (a.caller_name || a.project)) {
      const { data: created } = await service.from("meta_leads").insert({
        full_name: a.caller_name?.trim() || `Caller ${phone}`,
        phone,
        city:      a.city_or_zip?.trim() || null,
        raw_paste: `Phone call (AI receptionist) ${callId}`,
        notes:     ["Source: Phone call (AI receptionist)", a.project ? `Project: ${a.project}` : null,
                    a.language ? `Language: ${a.language}` : null, noteLine].filter(Boolean).join("\n"),
        list:      "call_list",
      }).select("id").single()
      leadId = created?.id ?? null
      leadAction = created ? "created" : "none"
    }
  }
  if (leadAction === "duplicate") return NextResponse.json({ ok: true, skipped: true, reason: "duplicate" })

  // 2. Text David
  const tag = a.appointment_booked ? "BOOKED" : a.needs_callback ? "CALL BACK" : "FYI"
  const owner = process.env.OWNER_CELL
  if (owner) {
    const text = [
      `AI receptionist [${tag}]: ${a.caller_name || "Unknown caller"} ${phone ?? ""}`.trim(),
      a.project ? `Project: ${a.project}` : null,
      summary.slice(0, 400),
      a.action_for_owner ? `To do: ${a.action_for_owner}` : null,
    ].filter(Boolean).join("\n")
    const sms = await sendQuoSms(owner, text)
    if (!sms.ok) console.error("[retell/webhook] owner text failed:", sms.error)
  }

  // 3. Email the transcript
  const to = process.env.ASSISTANT_OWNER_EMAIL
  if (to && process.env.SMTP_USER) {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    try {
      await createTransporter().sendMail({
        from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to,
        subject: `AI call [${tag}]: ${a.caller_name || phone || "Unknown caller"}`,
        html:    buildHtmlEmail({
          title:       `Phone call — ${tag}`,
          preheader:   summary.slice(0, 120),
          companyName: "Omdan Development",
          bodyLines: [
            `<b>Caller:</b> ${esc(a.caller_name || "Unknown")} ${esc(phone ?? "")}`,
            `<b>When:</b> ${esc(stamp)}`,
            a.project ? `<b>Project:</b> ${esc(a.project)}` : null,
            a.action_for_owner ? `<b>To do:</b> ${esc(a.action_for_owner)}` : null,
            `<b>Summary:</b> ${esc(summary)}`,
            call.recording_url ? `<a href="${call.recording_url}">Listen to the recording</a>` : null,
            "",
            `<b>Transcript</b>`,
            ...call.transcript!.split("\n").map(esc),
          ].filter((l): l is string => l !== null),
        }),
      })
    } catch (err) {
      console.error("[retell/webhook] email failed:", err)
    }
  }

  return NextResponse.json({ ok: true, lead_id: leadId, lead_action: leadAction })
}
