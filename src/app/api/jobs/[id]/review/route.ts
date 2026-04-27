import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { id } = await params
  const { action } = await req.json() as { action: string }

  if (action === "request") {
    const { data: job } = await supabase
      .from("jobs")
      .select("review_requested_at")
      .eq("id", id)
      .single()

    if (!job) return new Response("Not found", { status: 404 })

    if (job.review_requested_at) {
      return Response.json({ review_requested_at: job.review_requested_at })
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from("jobs")
      .update({ review_requested_at: now })
      .eq("id", id)
      .select("review_requested_at")
      .single()

    if (error) return new Response(error.message, { status: 500 })
    return Response.json(data)
  }

  if (action === "complete" || action === "uncomplete") {
    const { data, error } = await supabase
      .from("jobs")
      .update({ review_completed: action === "complete" })
      .eq("id", id)
      .select("review_completed")
      .single()

    if (error) return new Response(error.message, { status: 500 })
    return Response.json(data)
  }

  return new Response("Invalid action", { status: 400 })
}
