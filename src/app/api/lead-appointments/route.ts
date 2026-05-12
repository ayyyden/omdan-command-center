import { NextResponse } from "next/server"
import { getSessionMember } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

// GET /api/lead-appointments?date=YYYY-MM-DD
export async function GET(req: Request) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const date = searchParams.get("date")
  if (!date) return NextResponse.json({ error: "date param required" }, { status: 400 })

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("lead_appointments")
    .select(`
      id, customer_id, scheduled_date, start_time, end_time,
      status, source, partner_reference, project_summary, notes, category_code,
      customer:customers(id, name, address)
    `)
    .eq("scheduled_date", date)
    .not("status", "in", "(cancelled)")
    .order("start_time", { ascending: true, nullsFirst: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/lead-appointments — create a new lead appointment (and optionally a customer)
export async function POST(req: Request) {
  const session = await getSessionMember()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json() as {
    customer_id?:      string | null
    name?:             string | null
    phone?:            string | null
    address?:          string | null
    scheduled_date:    string
    start_time?:       string | null
    end_time?:         string | null
    source?:           string
    partner_reference?: string | null
    project_summary?:  string | null
    notes?:            string | null
    raw_text?:         string | null
    category_code?:    string | null
  }

  if (!body.scheduled_date) {
    return NextResponse.json({ error: "scheduled_date is required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Resolve owner user_id
  const ownerEmail = process.env.ASSISTANT_OWNER_EMAIL
  let userId: string | null = null
  if (ownerEmail) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("user_id")
      .ilike("email", ownerEmail)
      .not("user_id", "is", null)
      .in("role", ["owner", "admin"])
      .single()
    userId = (tm?.user_id as string) ?? null
  }
  if (!userId) {
    const { data: tm } = await supabase
      .from("team_members")
      .select("user_id")
      .eq("role", "owner")
      .eq("status", "active")
      .single()
    userId = (tm?.user_id as string) ?? null
  }
  if (!userId) {
    return NextResponse.json({ error: "Owner user not found" }, { status: 500 })
  }

  let customerId = body.customer_id ?? null

  // Create customer if no customer_id provided but name given
  if (!customerId && body.name) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .ilike("name", body.name.trim())
      .limit(1)
      .maybeSingle()

    if (existing) {
      customerId = existing.id as string
    } else {
      const { data: created } = await supabase
        .from("customers")
        .insert({
          name:        body.name.trim(),
          phone:       body.phone  ?? null,
          address:     body.address ?? null,
          lead_source: body.source ?? null,
          status:      "New Lead",
          user_id:     userId,
        })
        .select("id")
        .single()
      customerId = (created?.id as string) ?? null
    }
  }

  const { data, error } = await supabase
    .from("lead_appointments")
    .insert({
      customer_id:       customerId,
      user_id:           userId,
      scheduled_date:    body.scheduled_date,
      start_time:        body.start_time   ?? null,
      end_time:          body.end_time     ?? null,
      status:            "scheduled",
      source:            body.source       ?? "partner",
      partner_reference: body.partner_reference ?? null,
      project_summary:   body.project_summary ?? null,
      notes:             body.notes         ?? null,
      raw_text:          body.raw_text      ?? null,
      category_code:     body.category_code ?? null,
    })
    .select("id, customer_id, scheduled_date, start_time, end_time, status")
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ appointment_id: data.id, customer_id: customerId })
}
