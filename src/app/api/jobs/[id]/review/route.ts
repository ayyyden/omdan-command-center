import { NextRequest } from "next/server"
import { requirePermission, hasJobScope } from "@/lib/auth-helpers"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("jobs:update_status")
  if (session instanceof Response) return session
  const { supabase, role, pmId } = session

  const { id } = await params

  // PM scope enforcement — verify this PM owns the job before any action
  if (hasJobScope(role)) {
    const { data: ownership } = await supabase
      .from("jobs")
      .select("project_manager_id")
      .eq("id", id)
      .single()
    if (!ownership || ownership.project_manager_id !== pmId) {
      return new Response("Forbidden", { status: 403 })
    }
  }

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
