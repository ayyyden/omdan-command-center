import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { upsertLeadCard, todayLabel } from "@/lib/lead-card"
import { notifyLiaAction } from "@/lib/lia-notifications"

// POST /api/leads/google-ads — Google Ads lead form webhook.
// In Google Ads: the lead form asset → "Lead delivery" → Webhook URL
//   https://omdan-command-center.vercel.app/api/leads/google-ads
// and Key = the value of GOOGLE_ADS_LEAD_KEY (Vercel env). Google posts each
// lead as { lead_id, google_key, campaign_id, form_id, gcl_id, is_test,
// user_column_data: [{ column_id, column_name, string_value }] }.
// The lead goes on the Meta Lead Jobs call list (the team's call queue) and
// gets a lead card right away, like Facebook instant-form leads.

interface Column { column_id?: string; column_name?: string; string_value?: string }
interface GoogleLead {
  lead_id?: string; google_key?: string; campaign_id?: string | number; adgroup_id?: string | number
  form_id?: string | number; creative_id?: string | number; gcl_id?: string; is_test?: boolean
  user_column_data?: Column[]
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as GoogleLead
  const expected = process.env.GOOGLE_ADS_LEAD_KEY
  if (!expected || body.google_key !== expected) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const cols = body.user_column_data ?? []
  const get = (...ids: string[]) => cols.find((c) => ids.includes((c.column_id ?? "").toUpperCase()))?.string_value?.trim() || null
  const first = get("FIRST_NAME"), last = get("LAST_NAME")
  const name = get("FULL_NAME") ?? ([first, last].filter(Boolean).join(" ") || null)
  const phone = get("PHONE_NUMBER", "WORK_PHONE")
  const email = get("EMAIL", "WORK_EMAIL")
  const street = get("STREET_ADDRESS")
  const city = get("CITY")
  const region = get("REGION")
  const zip = get("POSTAL_CODE")
  const address = street ? [street, city, [region, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : null
  const known = new Set(["FULL_NAME", "FIRST_NAME", "LAST_NAME", "PHONE_NUMBER", "WORK_PHONE", "EMAIL", "WORK_EMAIL", "STREET_ADDRESS", "CITY", "REGION", "POSTAL_CODE", "COUNTRY"])
  const answers = cols
    .filter((c) => !known.has((c.column_id ?? "").toUpperCase()) && c.string_value?.trim())
    .map((c) => `${c.column_name || c.column_id}: ${c.string_value!.trim()}`)

  const test = body.is_test === true
  const fullName = `${test ? "[TEST] " : ""}${name ?? (phone ? `Lead ${phone}` : "Google lead")}`
  const ref = `Google Ads lead ${body.lead_id ?? ""}`.trim()
  const service = createServiceClient()

  // Google retries until it gets a 200 — never store the same lead twice
  if (body.lead_id) {
    const { data: dup } = await service.from("meta_leads").select("id").eq("raw_paste", ref).limit(1)
    if (dup?.length) return NextResponse.json({ ok: true, skipped: "duplicate" })
  }

  const notes = [
    `Google Ads lead form${body.campaign_id ? `, campaign ${body.campaign_id}` : ""}${body.form_id ? `, form ${body.form_id}` : ""}`,
    ...answers,
    body.gcl_id ? `gclid: ${body.gcl_id}` : null,
  ].filter(Boolean) as string[]

  const { data: lead, error } = await service.from("meta_leads").insert({
    full_name: fullName, phone, email, address, city, raw_paste: ref, notes: notes.join("\n"), list: "call_list",
    utm_source: "google", utm_campaign: body.campaign_id ? String(body.campaign_id) : null,
  }).select("id").single()
  if (error || !lead) {
    console.error("[leads/google-ads] insert failed:", error?.message)
    return NextResponse.json({ error: "Couldn't save the lead" }, { status: 500 })
  }

  await upsertLeadCard(service, {
    name: fullName, phone, email, address: street ? address : null, city,
    leadSource: "google",
    heading: `Google Ads lead form — ${todayLabel()}`,
    details: notes,
    metaLeadId: lead.id,
  }).catch((e) => console.error("[leads/google-ads] lead card failed:", e))

  await notifyLiaAction({
    text: [`🆕 New Google Ads lead${test ? " (TEST)" : ""}`, `👤 ${fullName}${phone ? `  ${phone}` : ""}`, email ? `✉️ ${email}` : null, address ? `📍 ${address}` : null, ...answers.slice(0, 6)].filter(Boolean).join("\n"),
  }).catch(() => false)

  return NextResponse.json({ ok: true })
}
