import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function GET() {
  const session = await requirePermission("customers:view")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data, error } = await supabase
    .from("lead_sources")
    .select("value, label, is_default")
    .is("archived_at", null)
    .order("sort_order")
    .order("label")

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const session = await requirePermission("customers:create")
  if (session instanceof Response) return session
  const { supabase } = session

  const { label } = await req.json() as { label: string }
  if (!label?.trim()) return Response.json({ error: "Label required" }, { status: 400 })

  const value = label.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "")
  if (!value) return Response.json({ error: "Invalid label" }, { status: 400 })

  const { data, error } = await supabase
    .from("lead_sources")
    .insert({ value, label: label.trim() })
    .select("value, label, is_default")
    .single()

  if (error) {
    if (error.code === "23505") return Response.json({ error: "Source already exists" }, { status: 409 })
    return Response.json({ error: error.message }, { status: 500 })
  }
  return Response.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const session = await requirePermission("customers:create")
  if (session instanceof Response) return session
  const { supabase } = session

  const { value } = await req.json() as { value: string }
  if (!value) return Response.json({ error: "Value required" }, { status: 400 })

  const { data: source } = await supabase
    .from("lead_sources")
    .select("is_default")
    .eq("value", value)
    .single()

  if (!source) return Response.json({ error: "Not found" }, { status: 404 })
  if (source.is_default) return Response.json({ error: "Built-in lead sources cannot be deleted" }, { status: 403 })

  // Check usage — soft-delete if already used so existing lead records are unchanged
  const { count } = await supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("lead_source", value)

  if (count && count > 0) {
    const { error } = await supabase
      .from("lead_sources")
      .update({ archived_at: new Date().toISOString() })
      .eq("value", value)

    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json({ archived: true, affected: count })
  }

  const { error } = await supabase
    .from("lead_sources")
    .delete()
    .eq("value", value)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ deleted: true })
}
