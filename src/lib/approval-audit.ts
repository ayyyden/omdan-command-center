import { createHash } from "crypto"
import { createServiceClient } from "@/lib/supabase/service"

export type AuditAction  = "viewed" | "signed" | "approved" | "declined"
export type AuditDocType = "contract" | "estimate" | "change_order"

export interface AuditEntry {
  documentType:   AuditDocType
  documentId:     string
  tokenHash:      string
  action:         AuditAction
  customerName?:  string | null
  customerEmail?: string | null
  ipAddress?:     string | null
  userAgent?:     string | null
  metadata?:      Record<string, unknown>
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function getIp(headers: { get(name: string): string | null }): string | null {
  const fwd = headers.get("x-forwarded-for")
  if (fwd) return fwd.split(",")[0].trim()
  return headers.get("x-real-ip") ?? null
}

export function getUa(headers: { get(name: string): string | null }): string | null {
  return headers.get("user-agent") ?? null
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from("approval_audit_logs").insert({
      document_type:  entry.documentType,
      document_id:    entry.documentId,
      token_hash:     entry.tokenHash,
      action:         entry.action,
      customer_name:  entry.customerName  ?? null,
      customer_email: entry.customerEmail ?? null,
      ip_address:     entry.ipAddress     ?? null,
      user_agent:     entry.userAgent     ?? null,
      metadata:       entry.metadata      ?? null,
    })
  } catch {
    // Non-fatal — never let audit logging break the signing flow
  }
}
