import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function GET() {
  const session = await requirePermission("lia:chat")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data, error } = await supabase
    .from("assistant_conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(30)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ conversations: data ?? [] })
}

export async function POST(_req: NextRequest) {
  const session = await requirePermission("lia:chat")
  if (session instanceof Response) return session
  const { supabase, userId } = session

  const { data, error } = await supabase
    .from("assistant_conversations")
    .insert({ user_id: userId })
    .select("id, title, created_at, updated_at")
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
