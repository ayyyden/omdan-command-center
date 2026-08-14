import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { buildNoAnswerSms, type SmsLanguage } from "@/lib/meta-lead-sms"
import { sendQuoSms } from "@/lib/quo-client"

interface RouteCtx { params: Promise<{ id: string }> }

// POST /api/meta-leads/[id]/no-answer-sms
// Sends the "No Answer" follow-up text via Quo. Called on the FIRST miss
// only (client decides that, same as the old clipboard-copy behavior) —
// this route just sends whatever text it's asked to, in whichever language.
export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("meta_leads:manage")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json().catch(() => ({})) as { language?: SmsLanguage }
  const language: SmsLanguage = body.language === "es" ? "es" : "en"

  const { data: lead, error: fetchErr } = await supabase
    .from("meta_leads")
    .select("full_name, phone")
    .eq("id", id)
    .single()

  if (fetchErr || !lead) {
    return Response.json({ error: fetchErr?.message ?? "Lead not found" }, { status: 404 })
  }
  if (!lead.phone) {
    return Response.json({ error: "This lead has no phone number on file" }, { status: 400 })
  }

  const text = buildNoAnswerSms(lead.full_name, language)
  const result = await sendQuoSms(lead.phone, text)

  if (!result.ok) {
    return Response.json({ error: result.error, text }, { status: 502 })
  }

  return Response.json({ ok: true })
}
