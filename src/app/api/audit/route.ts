import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"

const VALID_TYPES = ["contract", "estimate", "change_order"]

export async function GET(req: NextRequest) {
  const session = await requirePermission("customers:create")
  if (session instanceof Response) return session
  const { role, supabase } = session

  if (!["owner", "admin"].includes(role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 })
  }

  const { searchParams } = req.nextUrl
  const documentType = searchParams.get("documentType")
  const documentId   = searchParams.get("documentId")

  if (!documentType || !documentId) {
    return Response.json({ error: "Missing documentType or documentId" }, { status: 400 })
  }
  if (!VALID_TYPES.includes(documentType)) {
    return Response.json({ error: "Invalid documentType" }, { status: 400 })
  }

  const { data: logs } = await supabase
    .from("approval_audit_logs")
    .select("id, created_at, action, customer_name, customer_email, ip_address, user_agent, metadata")
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .order("created_at")

  return Response.json(logs ?? [])
}
