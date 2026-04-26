import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { data: co } = await supabase
    .from("change_orders")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single()

  if (!co) return Response.json({ error: "Not found" }, { status: 404 })

  const { error } = await supabase
    .from("change_orders")
    .update({ approval_token: crypto.randomUUID() })
    .eq("id", id)

  if (error) return Response.json({ error: "Failed to regenerate token" }, { status: 500 })

  return Response.json({ success: true })
}
