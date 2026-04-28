import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await requirePermission("change_orders:delete")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data: co } = await supabase
    .from("change_orders")
    .select("id")
    .eq("id", id)
    .single()

  if (!co) return Response.json({ error: "Not found" }, { status: 404 })

  const { error } = await supabase
    .from("change_orders")
    .update({ approval_token: crypto.randomUUID() })
    .eq("id", id)

  if (error) return Response.json({ error: "Failed to regenerate token" }, { status: 500 })

  return Response.json({ success: true })
}
