import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

export async function POST(req: NextRequest) {
  const { job_id, title, description, amount, notes } = await req.json()

  if (!job_id || !title || amount === undefined || amount === null) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const session = await requirePermission("change_orders:create")
  if (session instanceof Response) return session
  const { userId, supabase } = session

  const { data: job } = await supabase
    .from("jobs")
    .select("id, customer_id")
    .eq("id", job_id)
    .single()

  if (!job) return Response.json({ error: "Job not found" }, { status: 404 })

  const { data: co, error } = await supabase
    .from("change_orders")
    .insert({
      user_id:     userId,
      job_id,
      customer_id: job.customer_id,
      title,
      description: description ?? null,
      amount:      Number(amount),
      notes:       notes ?? null,
      status:      "draft",
    })
    .select()
    .single()

  if (error) return Response.json({ error: "Failed to create change order" }, { status: 500 })

  return Response.json({ data: co })
}
