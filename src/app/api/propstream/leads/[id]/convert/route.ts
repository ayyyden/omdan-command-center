import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

interface RouteCtx { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteCtx) {
  const { id } = await params
  const session = await requirePermission("propstream:call")
  if (session instanceof Response) return session
  const { supabase } = session

  const body = await req.json() as { customer_id?: string }

  const { error } = await supabase
    .from("propstream_leads")
    .update({
      status:               "converted",
      converted_customer_id: body.customer_id ?? null,
    })
    .eq("id", id)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  return Response.json({ ok: true })
}
