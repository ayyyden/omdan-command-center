import { NextRequest } from "next/server"
import { verifyRetellSecret, readToolCall, toolReply, phoneDigits, speakDateTime } from "@/lib/retell"
import { createServiceClient } from "@/lib/supabase/service"

// POST /api/retell/lookup — Retell tool "lookup_caller".
// Finds who is calling by phone number (caller ID unless the caller gives
// another number): their name, whether they're a customer with a job, and any
// upcoming estimate appointment, so the agent can greet returning callers and
// confirm their appointment.
export async function POST(req: NextRequest) {
  const authErr = verifyRetellSecret(req)
  if (authErr) return authErr

  const { args, call } = await readToolCall<{ phone?: string; language?: "en" | "es" }>(req)
  const lang = args.language === "es" ? "es" : "en"
  const digits = phoneDigits(args.phone || call.from_number)
  if (digits.length !== 10) return toolReply({ ok: true, found: false, message: "No caller ID. Treat as a new caller." })

  const service = createServiceClient()
  const like = `%${digits.slice(-4)}%`
  const [leadsRes, customersRes] = await Promise.all([
    service.from("meta_leads")
      .select("id, full_name, phone, address, list, scheduled_at, calendar_event_id")
      .ilike("phone", like).order("created_at", { ascending: false }).limit(20),
    service.from("customers")
      .select("id, name, phone, address, status, service_type")
      .ilike("phone", like).order("created_at", { ascending: false }).limit(20),
  ])
  const leads = (leadsRes.data ?? []).filter((l) => phoneDigits(l.phone) === digits)
  const customers = (customersRes.data ?? []).filter((c) => phoneDigits(c.phone) === digits)

  if (!leads.length && !customers.length) {
    return toolReply({ ok: true, found: false, message: "New caller. Not in our system." })
  }

  const now = Date.now()
  const upcoming = leads
    .filter((l) => l.list === "scheduled" && l.scheduled_at && new Date(l.scheduled_at).getTime() > now)
    .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0]

  const customer = customers[0]
  const jobsRes = customer
    ? await service.from("jobs").select("id, title, status").eq("customer_id", customer.id).limit(5)
    : null
  const jobs = jobsRes?.data ?? []

  return toolReply({
    ok:   true,
    found: true,
    name: customer?.name ?? leads[0]?.full_name ?? null,
    address: upcoming?.address ?? customer?.address ?? leads[0]?.address ?? null,
    upcoming_estimate: upcoming
      ? { appointment_ref: upcoming.id, when: speakDateTime(upcoming.scheduled_at!, lang), address: upcoming.address }
      : null,
    is_customer_with_job: jobs.length > 0,
    jobs: jobs.map((j) => ({ title: j.title, status: j.status })),
    message: upcoming
      ? "Returning caller with an upcoming estimate. Greet them by first name; if they're calling about it, confirm it with confirm_appointment."
      : jobs.length
        ? "Existing customer with a job. For anything about their job, offer to transfer to David."
        : "Known caller (past lead). Greet them by first name.",
  })
}
