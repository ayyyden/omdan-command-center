import { timingSafeEqual } from "node:crypto"
import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { addDaysLA, getTodayLA } from "@/lib/utils"

// Read-only feed for the Yomi personal app: what the owner needs to know about today.
// Reads with the service client, writes nothing, and uses its own secret. ASSISTANT_SECRET
// is deliberately not accepted here, because that one can also run actions.
function authorized(req: Request) {
  const expected = process.env.YOMI_FEED_SECRET
  if (!expected) return false
  const got = Buffer.from(req.headers.get("x-yomi-secret") ?? "")
  const want = Buffer.from(expected)
  return got.length === want.length && timingSafeEqual(got, want)
}

const MAX_LEADS = 25

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const param = new URL(req.url).searchParams.get("date")
  const date = param && /^\d{4}-\d{2}-\d{2}$/.test(param) ? param : getTodayLA()
  const days = Array.from({ length: 15 }, (_, i) => addDaysLA(date, i))
  const db = createServiceClient()

  const [appointments, leads] = await Promise.all([
    db
      .from("lead_appointments")
      .select("id, customer_id, scheduled_date, start_time, status, project_summary, notes")
      .gte("scheduled_date", days[0])
      .lte("scheduled_date", days[days.length - 1])
      .eq("status", "scheduled")
      .order("scheduled_date"),
    db
      .from("meta_leads")
      .select("id, full_name, phone, city, address, list, last_outcome, scheduled_at, notes, created_at")
      .in("list", ["call_list", "second_call_list", "schedule_call_list", "scheduled"])
      .order("created_at", { ascending: false })
      .limit(200),
  ])

  const failed = appointments.error ?? leads.error
  if (failed) {
    console.error("yomi feed failed", failed.message)
    return NextResponse.json({ error: "Could not read the CRM." }, { status: 500 })
  }

  const customerIds = [...new Set((appointments.data ?? []).map((a) => a.customer_id).filter(Boolean))]
  const { data: customers } = customerIds.length
    ? await db.from("customers").select("id, name, phone, address").in("id", customerIds)
    : { data: [] as { id: string; name: string; phone: string | null; address: string | null }[] }
  const customerById = new Map((customers ?? []).map((c) => [c.id, c]))

  const all = leads.data ?? []
  const toCall = all.filter((l) => l.list !== "scheduled")
  // Newest are already first. The most urgent lists stay in, and the total is reported.
  const rank: Record<string, number> = { call_list: 0, schedule_call_list: 1, second_call_list: 2 }
  const ranked = [...toCall].sort((a, b) => (rank[a.list] ?? 9) - (rank[b.list] ?? 9))

  return NextResponse.json({
    date,
    appointments: (appointments.data ?? []).map((a) => {
      const c = a.customer_id ? customerById.get(a.customer_id) : null
      return { id: a.id, name: c?.name ?? null, phone: c?.phone ?? null, address: c?.address ?? null, date: a.scheduled_date, time: a.start_time, summary: a.project_summary, notes: a.notes }
    }),
    scheduledLeads: all
      .filter((l) => l.list === "scheduled" && l.scheduled_at)
      .map((l) => ({ id: l.id, name: l.full_name, phone: l.phone, address: l.address, city: l.city, at: l.scheduled_at, notes: l.notes })),
    leadsToCall: ranked.slice(0, MAX_LEADS).map((l) => ({ id: l.id, name: l.full_name, phone: l.phone, city: l.city, list: l.list, lastOutcome: l.last_outcome, notes: l.notes })),
    leadsToCallTotal: toCall.length,
  })
}
