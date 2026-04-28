import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function POST(req: NextRequest) {
  const { ids } = (await req.json()) as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: "No IDs provided" }, { status: 400 })
  }

  const session = await requirePermission("contracts:delete")
  if (session instanceof Response) return session
  const { supabase } = session

  const { error } = await supabase
    .from("sent_contracts")
    .delete()
    .in("id", ids)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
