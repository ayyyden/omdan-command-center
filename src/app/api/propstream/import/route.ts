import { NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { requirePermission } from "@/lib/auth-helpers"
import { parseCSV } from "@/lib/propstream-parser"

const BATCH = 100

export async function POST(req: NextRequest) {
  const session = await requirePermission("propstream:import")
  if (session instanceof Response) return session
  const { supabase, userId } = session

  const formData = await req.formData()
  const file = formData.get("file") as File | null
  const name = (formData.get("name") as string | null)?.trim()

  if (!file) return Response.json({ error: "file is required" }, { status: 400 })
  if (!name) return Response.json({ error: "name is required" }, { status: 400 })

  const csvText = await file.text()
  const { leads, summary } = parseCSV(csvText)

  const { data: list, error: listErr } = await supabase
    .from("propstream_lists")
    .insert({
      name,
      filename: file.name,
      created_by: userId,
      row_count: summary.row_count,
      imported_count: leads.length,
      callable_count: summary.callable_count,
      no_phone_count: summary.no_phone_count,
      dnc_removed: summary.dnc_removed,
      dupe_removed: summary.dupe_removed,
      skipped_count: summary.skipped_count,
    })
    .select("id")
    .single()

  if (listErr || !list) {
    return Response.json({ error: listErr?.message ?? "Failed to create list" }, { status: 500 })
  }

  for (let i = 0; i < leads.length; i += BATCH) {
    const batch = leads.slice(i, i + BATCH)

    const leadRows = batch.map((l) => ({
      id: randomUUID(),
      list_id: list.id,
      owner_name: l.owner_name,
      owner2_name: l.owner2_name,
      property_address: l.property_address,
      property_city: l.property_city,
      property_state: l.property_state,
      property_zip: l.property_zip,
      property_county: l.property_county,
      apn: l.apn,
      mailing_address: l.mailing_address,
      owner_occupied: l.owner_occupied,
      property_type: l.property_type,
      bedrooms: l.bedrooms,
      bathrooms: l.bathrooms,
      sqft: l.sqft,
      lot_sqft: l.lot_sqft,
      year_built: l.year_built,
      assessed_value: l.assessed_value,
      last_sale_date: l.last_sale_date,
      last_sale_amount: l.last_sale_amount,
      estimated_value: l.estimated_value,
      estimated_equity: l.estimated_equity,
      estimated_ltv: l.estimated_ltv,
      open_loans_count: l.open_loans_count,
      open_loans_balance: l.open_loans_balance,
      mls_status: l.mls_status,
      mls_date: l.mls_date,
      mls_amount: l.mls_amount,
      emails: l.emails,
      status: l.has_callable_phone ? "new" : "no_callable_phone",
      raw_data: l.raw_data,
    }))

    const phoneRows = batch.flatMap((l, idx) =>
      l.phones.map((p) => ({
        lead_id: leadRows[idx].id,
        phone: p.phone,
        phone_type: p.phone_type,
        position: p.position,
      }))
    )

    const { error: leadsErr } = await supabase.from("propstream_leads").insert(leadRows)
    if (leadsErr) {
      return Response.json({ error: `Batch ${i / BATCH + 1} failed: ${leadsErr.message}` }, { status: 500 })
    }

    if (phoneRows.length > 0) {
      const { error: phonesErr } = await supabase.from("propstream_lead_phones").insert(phoneRows)
      if (phonesErr) {
        return Response.json({ error: `Phone batch ${i / BATCH + 1} failed: ${phonesErr.message}` }, { status: 500 })
      }
    }
  }

  return Response.json({
    list_id: list.id,
    summary: {
      ...summary,
      imported_count: leads.length,
    },
  })
}
