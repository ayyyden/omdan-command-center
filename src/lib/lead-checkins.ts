// "How did today go?" At 8 PM Lia sends David one numbered list with every
// estimate on that day's calendar. He answers in plain words ("1 didn't answer,
// 2 sale 27632, 3 moved to Tuesday 2-3 PM") and Lia turns it into one
// log_lead_outcomes approval, which applyLeadOutcomes carries out.

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  LEAD_COLUMNS, BRANDS, leadBrand, leadLanguage, ptInstant, ptParts, rescheduleLead, addLeadNote,
  type ScheduledLead,
} from "@/lib/appointments"
import { notifyLiaAction } from "@/lib/lia-notifications"
import { phoneDigits, speakSlot } from "@/lib/retell"
import { startFollowup, stopFollowups } from "@/lib/followups"
import { deriveJobTitle } from "@/lib/job-title"
import { sendQuoSms } from "@/lib/quo-client"
import { firstName, type Brand } from "@/lib/appointments"

function rescheduleAskText(fullName: string, brand: Brand, lang: "en" | "es") {
  const name = firstName(fullName)
  return lang === "es"
    ? `Hola ${name}, soy David de ${BRANDS[brand].name}. Necesitamos cambiar la hora de su estimado. ¿Qué día y hora le quedan bien?`
    : `Hi ${name}, it's David with ${BRANDS[brand].name}. We need to move your estimate to a new time. What day and time work best for you?`
}

const CHECKIN_TIME = "20:00"   // PT

function timeLabel(iso: string) {
  const { time } = ptParts(iso)
  const [h, m] = time.split(":").map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`
}

function jobOf(lead: ScheduledLead): string | null {
  const notes = lead.notes ?? ""
  return notes.match(/^Interested in:\s*(?:Omdan Development:\s*)?([^;\n]+)/im)?.[1]?.trim()
    ?? notes.match(/^Project:\s*(.+)$/im)?.[1]?.trim()
    ?? null
}

/** Sends today's check-in once, at 8 PM PT (called by the 5-minute cron). */
export async function sendDailyCheckin(service: SupabaseClient, now = new Date()) {
  const { date, time } = ptParts(now.toISOString())
  if (time < CHECKIN_TIME) return { sent: false, reason: "before 8 PM" }

  const { count, error: countErr } = await service.from("lead_checkins")
    .select("id", { count: "exact", head: true }).eq("checkin_date", date)
  if (countErr) return { sent: false, reason: countErr.message }
  if (count) return { sent: false, reason: "already sent" }

  const { data } = await service.from("meta_leads").select(LEAD_COLUMNS)
    .gte("scheduled_at", ptInstant(date, "00:00").toISOString())
    .lte("scheduled_at", ptInstant(date, "23:59").toISOString())
    .order("scheduled_at")
  const leads = ((data ?? []) as ScheduledLead[]).filter((l) => l.scheduled_at)
  if (!leads.length) return { sent: false, reason: "no estimates today" }

  const { error } = await service.from("lead_checkins").upsert(
    leads.map((l, i) => ({ checkin_date: date, meta_lead_id: l.id, position: i + 1 })),
    { onConflict: "checkin_date,meta_lead_id", ignoreDuplicates: true },
  )
  if (error) return { sent: false, reason: error.message }

  const day = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
  const lines = leads.map((l, i) => {
    const job = jobOf(l)
    return `${i + 1}. ${l.full_name}, ${timeLabel(l.scheduled_at!)} (${BRANDS[leadBrand(l)].name})${job ? `, ${job}` : ""}${l.address ? `\n    ${l.address}` : ""}`
  })
  const ok = await notifyLiaAction({
    text: `📋 How did today go? ${leads.length} estimate${leads.length === 1 ? "" : "s"} on ${day}:\n\n${lines.join("\n")}\n\n`
      + `Reply for each one, for example:\n"1 didn't answer, 2 sale 27632, 3 rescheduled to next Tuesday 2-3 PM, 4 no sale follow up, 5 no sale no follow up"`,
  })
  return { sent: ok, leads: leads.length }
}

/** Unanswered check-ins (last 7 days) for Lia's context, with the ids she needs. */
export async function pendingCheckinsContext(service: SupabaseClient): Promise<string> {
  const since = new Date(Date.now() - 7 * 24 * 3600_000).toISOString().slice(0, 10)
  const { data, error } = await service.from("lead_checkins")
    .select("id, checkin_date, position, meta_lead:meta_leads(id, full_name, phone, address, scheduled_at, notes)")
    .eq("status", "pending").gte("checkin_date", since)
    .order("checkin_date", { ascending: false }).order("position")
  if (error || !data?.length) return ""
  const lines = data.map((c) => {
    const l = (Array.isArray(c.meta_lead) ? c.meta_lead[0] : c.meta_lead) as ScheduledLead | null
    if (!l) return null
    return `  #${c.position} (${c.checkin_date}) checkin_id=${c.id} | meta_lead_id=${l.id} | "${l.full_name}" | ${l.phone ?? "no phone"} | ${l.scheduled_at ? timeLabel(l.scheduled_at) : "?"} | ${BRANDS[leadBrand(l)].name} | job=${jobOf(l) ?? "?"} | ${l.address ?? ""}`
  }).filter(Boolean)
  return lines.length ? `\n\nEVENING CHECK-INS WAITING FOR DAVID'S ANSWER (numbers match the 8 PM "How did today go?" list):\n${lines.join("\n")}` : ""
}

export type LeadOutcome = "no_show" | "rescheduled" | "needs_reschedule" | "no_sale" | "no_sale_follow_up" | "sale" | "other"

export interface LeadOutcomeInput {
  checkin_id?:   string | null
  meta_lead_id:  string
  full_name?:    string
  outcome:       LeadOutcome
  new_date?:     string | null   // YYYY-MM-DD (rescheduled)
  new_time?:     string | null   // HH:MM 24h (rescheduled)
  amount?:       number | null   // sale amount in dollars
  note?:         string | null
}

/** The CRM customer for this lead (matched by phone), created if there isn't one yet. */
async function customerFor(service: SupabaseClient, lead: ScheduledLead, ownerUserId: string) {
  const digits = phoneDigits(lead.phone)
  if (digits.length === 10) {
    const { data } = await service.from("customers").select("id, phone, address").ilike("phone", `%${digits.slice(-4)}%`)
    const found = (data ?? []).find((c) => phoneDigits(c.phone) === digits)
    if (found) return found as { id: string; address: string | null }
  }
  const { data: created } = await service.from("customers").insert({
    user_id: ownerUserId, name: lead.full_name, phone: lead.phone, address: lead.address,
    service_type: jobOf(lead), status: "New Lead",
  }).select("id, address").single()
  return created as { id: string; address: string | null } | null
}

export async function applyLeadOutcomes(service: SupabaseClient, ownerUserId: string, outcomes: LeadOutcomeInput[]) {
  const results: string[] = []
  for (const o of outcomes) {
    const { data } = await service.from("meta_leads").select(LEAD_COLUMNS).eq("id", o.meta_lead_id).maybeSingle()
    const lead = data as ScheduledLead | null
    if (!lead) { results.push(`${o.full_name ?? o.meta_lead_id}: lead not found`); continue }
    const name = lead.full_name
    const brand = leadBrand(lead)
    const lang = leadLanguage(lead)
    const note = o.note?.trim()
    try {
      const customer = await customerFor(service, lead, ownerUserId)
      const setCustomer = (fields: Record<string, unknown>) =>
        customer ? service.from("customers").update(fields).eq("id", customer.id) : Promise.resolve()
      const apptDate = lead.scheduled_at ? ptParts(lead.scheduled_at).date : null
      const setAppointment = (status: string) => customer && apptDate
        ? service.from("lead_appointments").update({ status }).eq("customer_id", customer.id).eq("scheduled_date", apptDate)
        : Promise.resolve()

      switch (o.outcome) {
        case "no_show": {
          await setAppointment("no_show")
          await setCustomer({ status: "Follow-Up Needed" })
          const f = lead.phone ? await startFollowup(service, { meta_lead_id: lead.id, customer_id: customer?.id, full_name: name, phone: lead.phone, brand, language: lang, job: jobOf(lead), reason: "no_show" }) : null
          await addLeadNote(service, lead, `Estimate: client didn't answer / no show${note ? ` (${note})` : ""}`)
          results.push(`${name}: no show, ${f?.ok ? "follow-up texts started (first one in 2 days)" : `follow-up not started: ${f?.error ?? "no phone"}`}`)
          break
        }
        case "needs_reschedule":
        case "rescheduled": {
          if (o.outcome === "needs_reschedule" || !o.new_date || !o.new_time) {
            // No new time yet: text the client to pick one; their reply goes to the team.
            if (!lead.phone) { results.push(`${name}: no phone, call them to find a new time`); break }
            await setCustomer({ status: "Follow-Up Needed" })
            const sms = await sendQuoSms(lead.phone, rescheduleAskText(name, brand, lang), BRANDS[brand].quoFrom)
            const f = await startFollowup(service, { meta_lead_id: lead.id, customer_id: customer?.id, full_name: name, phone: lead.phone, brand, language: lang, job: jobOf(lead), reason: "no_show", step: 1 })
            await addLeadNote(service, lead, `Estimate needs a new time${note ? ` (${note})` : ""}; texted the client to pick one`)
            results.push(`${name}: ${sms.ok ? "texted them to pick a new time, their reply comes to you" : `text failed (${sms.error ?? "unknown"}), call them`}${f.ok ? "" : ` (follow-up not started: ${f.error})`}`)
            break
          }
          const r = await rescheduleLead(service, lead, o.new_date, o.new_time, lang, "owner")
          if (r.ok) {
            await stopFollowups(service, lead.phone ?? "")
            await service.from("meta_leads").update({ list: "scheduled" }).eq("id", lead.id)
          }
          results.push(`${name}: ${r.ok ? `moved to ${speakSlot(o.new_date, o.new_time)}, calendar updated and customer texted` : r.message}`)
          break
        }
        case "no_sale": {
          await setAppointment("visited")
          await setCustomer({ status: "Closed Lost", lead_outcome: "OTHER", lead_outcome_at: new Date().toISOString() })
          await stopFollowups(service, lead.phone ?? "")
          await addLeadNote(service, lead, `Estimate: no sale, no follow-up${note ? ` (${note})` : ""}`, { list: "archive" })
          results.push(`${name}: closed, no sale`)
          break
        }
        case "no_sale_follow_up": {
          await setAppointment("estimate_sent")
          await setCustomer({ status: "Follow-Up Needed" })
          const f = lead.phone ? await startFollowup(service, { meta_lead_id: lead.id, customer_id: customer?.id, full_name: name, phone: lead.phone, brand, language: lang, job: jobOf(lead), reason: "no_sale" }) : null
          await addLeadNote(service, lead, `Estimate: no sale yet, following up${note ? ` (${note})` : ""}`)
          results.push(`${name}: ${f?.ok ? "follow-up texts started (first one in 2 days)" : `follow-up not started: ${f?.error ?? "no phone"}`}`)
          break
        }
        case "sale": {
          if (!customer) { results.push(`${name}: couldn't find or create the customer`); break }
          const amount = Number(o.amount ?? 0)
          let estimateId: string | null = null
          if (amount > 0) {
            const { data: est } = await service.from("estimates").insert({
              customer_id: customer.id, user_id: ownerUserId, title: jobOf(lead) ?? "Project",
              manual_total_price: amount, line_items: [], markup_percent: 0, tax_percent: 0,
              subtotal: amount, markup_amount: 0, tax_amount: 0, total: amount,
              status: "approved", approved_at: new Date().toISOString(), approval_token: crypto.randomUUID(),
              notes: note || null,
            }).select("id").single()
            estimateId = (est?.id as string) ?? null
          }
          const { data: job, error: jobErr } = await service.from("jobs").insert({
            customer_id: customer.id, user_id: ownerUserId, estimate_id: estimateId,
            title: deriveJobTitle(customer.address ?? lead.address, jobOf(lead) ?? name),
            description: [jobOf(lead), note].filter(Boolean).join("\n") || null, status: "scheduled",
          }).select("id, title").single()
          if (jobErr || !job) { results.push(`${name}: sale noted but the job failed: ${jobErr?.message}`); break }
          await setAppointment("converted")
          await setCustomer({ status: "Approved", lead_outcome: "SOLD", lead_outcome_at: new Date().toISOString() })
          await stopFollowups(service, lead.phone ?? "")
          await addLeadNote(service, lead, `SOLD${amount > 0 ? ` $${amount.toLocaleString("en-US")}` : ""}, job created${note ? ` (${note})` : ""}`, { list: "archive" })
          results.push(`${name}: 🎉 sold${amount > 0 ? ` $${amount.toLocaleString("en-US")}` : ""}, job "${job.title}" created`)
          break
        }
        default: {
          await addLeadNote(service, lead, `Estimate update: ${note ?? "(no details)"}`)
          results.push(`${name}: note saved`)
        }
      }
      if (o.checkin_id) {
        await service.from("lead_checkins").update({ status: "done", outcome: o.outcome, outcome_note: note ?? null }).eq("id", o.checkin_id)
      } else {
        await service.from("lead_checkins").update({ status: "done", outcome: o.outcome, outcome_note: note ?? null })
          .eq("meta_lead_id", lead.id).eq("status", "pending")
      }
    } catch (err) {
      results.push(`${name}: failed (${err instanceof Error ? err.message : String(err)})`)
    }
  }
  return results
}
