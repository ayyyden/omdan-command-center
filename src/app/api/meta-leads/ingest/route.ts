import { NextRequest, NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

// POST /api/meta-leads/ingest
// Called by the lia-bridge Telegram webhook when the "desertleads" bot posts
// a structured new-lead message into the team group — inserts straight onto
// the call list, same as the manual "add lead" dialog does, no approval
// gate (meta_leads has never required one; it's a call queue, not a
// financial/customer-record change).
export async function POST(req: NextRequest) {
  const authErr = verifyAssistantSecret(req)
  if (authErr) return authErr

  const body = await req.json().catch(() => ({})) as {
    full_name?: string
    phone?:     string | null
    email?:     string | null
    city?:      string | null
    homeowner?: string | null
    link?:      string | null
    raw_text?:  string | null
  }

  const full_name = body.full_name?.trim()
  if (!full_name) {
    return NextResponse.json({ error: "full_name is required" }, { status: 400 })
  }

  const service = createServiceClient()

  // Dedup on the numeric Meta/Facebook lead id embedded in the link, in case
  // the bot (or Telegram) redelivers the same lead.
  const ref = body.link?.match(/\/(\d{8,})(?:[/?]|$)/)?.[1] ?? null
  if (ref) {
    const { data: existing } = await service
      .from("meta_leads")
      .select("id")
      .ilike("raw_paste", `%${ref}%`)
      .limit(1)
    if (existing?.length) {
      return NextResponse.json({ ok: true, skipped: true, reason: "duplicate", lead_id: existing[0].id })
    }
  }

  const notesParts: string[] = []
  if (body.homeowner) notesParts.push(`Homeowner: ${body.homeowner}`)
  if (body.link) notesParts.push(`Meta Lead: ${body.link}`)

  const { data, error } = await service
    .from("meta_leads")
    .insert({
      full_name,
      email:     body.email?.trim() || null,
      phone:     body.phone?.trim() || null,
      city:      body.city?.trim() || null,
      raw_paste: body.raw_text ?? null,
      notes:     notesParts.length ? notesParts.join("\n") : null,
      list:      "call_list",
    })
    .select("id, full_name")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lead: data }, { status: 201 })
}
