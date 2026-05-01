import { NextResponse } from "next/server"
import { verifyAssistantSecret } from "@/lib/assistant-auth"
import { createServiceClient } from "@/lib/supabase/service"

// GET  /api/assistant/approvals — list pending (auto-expires stale ones first)
export async function GET(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const supabase = createServiceClient()
  const now = new Date().toISOString()

  // Auto-expire any pending approvals past their deadline
  await supabase
    .from("assistant_approvals")
    .update({ status: "expired", updated_at: now })
    .eq("status", "pending")
    .lt("expires_at", now)

  const { data, error } = await supabase
    .from("assistant_approvals")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ approvals: data })
}

// POST /api/assistant/approvals — create a new pending approval
export async function POST(req: Request) {
  const err = verifyAssistantSecret(req)
  if (err) return err

  const body = await req.json() as {
    channel: string
    action_type: string
    action_summary: string
    proposed_payload?: unknown
    requested_by_whatsapp?: string
    related_record_ids?: unknown
  }

  const { channel, action_type, action_summary, proposed_payload, requested_by_whatsapp, related_record_ids } = body

  if (!channel || !action_type || !action_summary) {
    return NextResponse.json({ error: "Missing required fields: channel, action_type, action_summary" }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("assistant_approvals")
    .insert({
      channel,
      action_type,
      action_summary,
      proposed_payload,
      requested_by_whatsapp,
      related_record_ids,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ approval: data }, { status: 201 })
}
