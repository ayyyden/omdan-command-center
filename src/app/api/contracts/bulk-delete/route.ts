import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const { ids } = (await req.json()) as { ids: string[] }

  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: "No IDs provided" }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { error } = await supabase
    .from("sent_contracts")
    .delete()
    .in("id", ids)
    .eq("user_id", user.id)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ success: true })
}
