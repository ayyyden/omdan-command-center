import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

// GET  /api/contracts/staff-values?id=<sent_contract_id>
//   → the staff fields of that document + what was filled in when it was sent
// POST /api/contracts/staff-values { sentContractId, staffFieldValues }
//   → change "your part" of a contract that was already sent, as long as the
//     customer hasn't signed it. Nothing is re-sent: the customer's link stays
//     the same and the preview / final signed PDF use the new values (both
//     read staff_field_values live — preview-pdf and sign/[token]).

export async function GET(req: NextRequest) {
  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { supabase } = session
  const id = req.nextUrl.searchParams.get("id")
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 })

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select("id, status, staff_field_values, contract_template_id, contract_template:contract_templates (name)")
    .eq("id", id)
    .single()
  if (!sent) return Response.json({ error: "Contract not found" }, { status: 404 })

  const { data: fields } = await supabase
    .from("contract_fields")
    .select("id, page_number, field_type, label, required, x, y, options")
    .eq("contract_template_id", sent.contract_template_id)
    .eq("fill_role", "staff")

  return Response.json({
    status: sent.status,
    name: (sent.contract_template as unknown as { name: string } | null)?.name ?? "Contract",
    fields: fields ?? [],
    values: (sent.staff_field_values as Record<string, string> | null) ?? {},
  })
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = (await req.json().catch(() => null)) as { sentContractId?: string; staffFieldValues?: Record<string, string> } | null
  if (!body?.sentContractId || !body.staffFieldValues || typeof body.staffFieldValues !== "object") {
    return Response.json({ error: "Missing sentContractId or staffFieldValues" }, { status: 400 })
  }

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select("id, status, bundle_id, contract_template_id")
    .eq("id", body.sentContractId)
    .single()
  if (!sent) return Response.json({ error: "Contract not found" }, { status: 404 })
  if (sent.status === "signed") return Response.json({ error: "The customer already signed this — it can't be changed" }, { status: 400 })

  const values = Object.fromEntries(Object.entries(body.staffFieldValues).filter(([, v]) => typeof v === "string"))
  const { error } = await supabase
    .from("sent_contracts")
    .update({ staff_field_values: Object.keys(values).length ? values : null })
    .eq("id", sent.id)
    .neq("status", "signed")
  if (error) return Response.json({ error: error.message }, { status: 500 })

  // A paired back page travels with its front and was sent with the same
  // values (prepare-signing.ts) — keep it in step
  if (sent.bundle_id) {
    const { data: backs } = await supabase
      .from("contract_templates")
      .select("id")
      .eq("attached_to_template_id", sent.contract_template_id)
    const backIds = (backs ?? []).map((b) => b.id)
    if (backIds.length) {
      await supabase
        .from("sent_contracts")
        .update({ staff_field_values: Object.keys(values).length ? values : null })
        .eq("bundle_id", sent.bundle_id)
        .in("contract_template_id", backIds)
        .neq("status", "signed")
    }
  }

  return Response.json({ ok: true })
}
