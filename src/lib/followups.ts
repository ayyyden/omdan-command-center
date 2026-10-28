// Text follow-ups for leads that didn't buy (or didn't show). Short, casual
// texts from the company's own Quo number on day 2, 5, 10, 21, 51 and 81 after
// the follow-up tag. Any reply from the customer stops it and tells David, who
// takes it from there. No prices, ever.

import type { SupabaseClient } from "@supabase/supabase-js"
import { BRANDS, firstName, ptInstant, ptParts, type Brand } from "@/lib/appointments"
import { sendQuoSms, toE164 } from "@/lib/quo-client"
import { phoneDigits } from "@/lib/retell"
import { notifyLiaAction } from "@/lib/lia-notifications"

/** Days after the tag for each text. */
const SCHEDULE_DAYS = [2, 5, 10, 21, 51, 81]
const SEND_TIME = "10:30"   // PT; texts only go out 10 AM–6:30 PM, never Saturday

export interface Followup {
  id:           string
  meta_lead_id: string | null
  customer_id:  string | null
  full_name:    string
  phone:        string
  brand:        Brand
  language:     "en" | "es"
  job:          string | null
  reason:       "no_sale" | "no_show"
  step:         number
  next_at:      string | null
  status:       string
  created_at:   string
}

function dueAt(startIso: string, step: number): string | null {
  const days = SCHEDULE_DAYS[step]
  if (days == null) return null
  const start = ptParts(startIso).date
  const d = new Date(`${start}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return ptInstant(d.toISOString().slice(0, 10), SEND_TIME).toISOString()
}

function followupText(f: Followup): string {
  const name = firstName(f.full_name)
  const brand = BRANDS[f.brand].name
  const job = f.job?.trim().toLowerCase() || (f.language === "es" ? "proyecto" : "project")
  const es = f.language === "es"
  const lines = f.reason === "no_show" && f.step === 0
    ? [es ? `Hola ${name}, soy David de ${brand}. Parece que no pudimos vernos para su estimado. ¿Quiere que busquemos otra hora? Dígame qué día le queda bien.`
          : `Hi ${name}, it's David with ${brand}. Looks like we missed each other for your estimate. Want to pick a new time? Just text me a day that works.`]
    : es
      ? [
          `Hola ${name}, soy David de ${brand}. Solo quería ver si tiene alguna pregunta sobre su ${job}.`,
          `Hola ${name}, ¿todavía pensando en el ${job}? Si algo le detiene, dígame y lo vemos juntos.`,
          `Hola ${name}, David de ${brand}. ¿Quiere que le aparte un lugar en el calendario para su ${job}?`,
          `Hola ${name}, ¡espero que esté bien! Cuando esté listo para seguir con su ${job}, solo escríbame aquí.`,
          `Hola ${name}, David de ${brand}. ¿Sigue en pie el ${job}? Aquí estoy cuando quiera.`,
          `Hola ${name}, David otra vez. Si en algún momento quiere retomar su ${job}, escríbame. ¡Que le vaya bien!`,
        ]
      : [
          `Hi ${name}, it's David with ${brand}. Just checking in on your ${job}. Any questions I can help with?`,
          `Hey ${name}, still thinking about the ${job}? If anything's holding you back, let me know and we'll figure it out.`,
          `Hi ${name}, David from ${brand}. Want me to hold a spot on the schedule for your ${job}?`,
          `Hi ${name}, hope all is well! Whenever you're ready to move forward on the ${job}, just text me here.`,
          `Hi ${name}, David with ${brand}. Is the ${job} still on your list? Happy to help whenever you're ready.`,
          `Hi ${name}, David again. If you ever want to pick the ${job} back up, just text me. Take care!`,
        ]
  return lines[Math.min(f.step, lines.length - 1)]
}

/** Tags a lead for follow-up (replaces any follow-up already running for that phone). */
export async function startFollowup(service: SupabaseClient, input: {
  meta_lead_id?: string | null
  customer_id?:  string | null
  full_name:     string
  phone:         string
  brand:         Brand
  language?:     "en" | "es"
  job?:          string | null
  reason?:       "no_sale" | "no_show"
}) {
  const phone = toE164(input.phone)
  if (!phone) return { ok: false as const, error: "no valid phone number" }
  await stopFollowups(service, phone, "stopped")
  const now = new Date().toISOString()
  const { data, error } = await service.from("lead_followups").insert({
    meta_lead_id: input.meta_lead_id ?? null,
    customer_id:  input.customer_id ?? null,
    full_name:    input.full_name,
    phone,
    brand:        input.brand,
    language:     input.language ?? "en",
    job:          input.job ?? null,
    reason:       input.reason ?? "no_sale",
    step:         0,
    next_at:      dueAt(now, 0),
  }).select("id, next_at").single()
  if (error) return { ok: false as const, error: error.message }
  return { ok: true as const, id: data.id as string, first_text_at: data.next_at as string }
}

async function activeFor(service: SupabaseClient, phone: string): Promise<Followup[]> {
  const digits = phoneDigits(phone)
  if (digits.length < 10) return []
  const { data } = await service.from("lead_followups").select("*").eq("status", "active").ilike("phone", `%${digits}`)
  return (data ?? []) as Followup[]
}

export async function stopFollowups(service: SupabaseClient, phone: string, status: "stopped" | "replied" | "done" = "stopped", reply?: string) {
  const rows = await activeFor(service, phone)
  if (rows.length) {
    await service.from("lead_followups")
      .update({ status, next_at: null, ...(reply ? { last_reply: reply.slice(0, 1000) } : {}) })
      .in("id", rows.map((r) => r.id))
  }
  return rows
}

/** A text came in from this number: if they were getting follow-ups, stop and tell David. */
export async function handleFollowupReply(service: SupabaseClient, from: string, text: string): Promise<boolean> {
  const rows = await stopFollowups(service, from, "replied", text)
  if (!rows.length) return false
  const f = rows[0]
  const stop = /^\s*(stop|unsubscribe|cancel|quit|end|alto|parar)\b/i.test(text)
  await notifyLiaAction({
    text: stop
      ? `${f.full_name} (${BRANDS[f.brand].name}) texted "${text.trim().slice(0, 200)}" to the follow-up, so the follow-ups are stopped.`
      : `💬 ${f.full_name} (${BRANDS[f.brand].name}, ${f.phone}) replied to the follow-up text:\n"${text.trim().slice(0, 500)}"\n\nFollow-ups are paused. Reply in Quo, or tell me what to do (book a time, follow up again, close it).`,
  })
  return true
}

/** Sends the follow-up texts that are due (called by the 5-minute cron). */
export async function runFollowups(service: SupabaseClient, now = new Date()) {
  const { time } = ptParts(now.toISOString())
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short" }).format(now)
  if (weekday === "Sat" || time < "10:00" || time > "18:30") return { sent: 0, waiting: "outside texting hours" }

  const { data, error } = await service.from("lead_followups").select("*")
    .eq("status", "active").lte("next_at", now.toISOString()).order("next_at").limit(10)
  if (error) return { sent: 0, error: error.message }

  let sent = 0
  for (const f of (data ?? []) as Followup[]) {
    const sms = await sendQuoSms(f.phone, followupText(f), BRANDS[f.brand].quoFrom)
    if (!sms.ok) {
      console.error("[followups] text failed:", f.id, sms.error)
      await service.from("lead_followups").update({ next_at: new Date(now.getTime() + 24 * 3600_000).toISOString() }).eq("id", f.id)
      continue
    }
    sent++
    const next = dueAt(f.created_at, f.step + 1)
    await service.from("lead_followups").update({
      step: f.step + 1, last_sent_at: now.toISOString(), next_at: next, status: next ? "active" : "done",
    }).eq("id", f.id)
  }
  return { sent }
}
