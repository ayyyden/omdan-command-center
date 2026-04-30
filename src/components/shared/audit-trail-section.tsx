import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck } from "lucide-react"

function actionStyle(action: string): string {
  const m: Record<string, string> = {
    viewed:   "bg-blue-50 text-blue-700 border border-blue-200",
    signed:   "bg-green-50 text-green-700 border border-green-200",
    approved: "bg-green-50 text-green-700 border border-green-200",
    declined: "bg-red-50 text-red-700 border border-red-200",
  }
  return m[action] ?? "bg-gray-50 text-gray-700 border border-gray-200"
}

function parseBrowser(ua: string | null): string {
  if (!ua) return "—"
  if (/iPhone|iPad/i.test(ua))            return "iOS"
  if (/Android/i.test(ua))               return "Android"
  if (/Edg\//i.test(ua))                 return "Edge"
  if (/Chrome/i.test(ua))                return "Chrome"
  if (/Firefox/i.test(ua))               return "Firefox"
  if (/Safari/i.test(ua))                return "Safari"
  return ua.slice(0, 28)
}

interface Props {
  documentType: "contract" | "estimate" | "change_order"
  documentId:   string
}

export async function AuditTrailSection({ documentType, documentId }: Props) {
  const supabase = await createClient()
  const { data: logs } = await supabase
    .from("approval_audit_logs")
    .select("id, created_at, action, customer_name, customer_email, ip_address, user_agent, metadata")
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .order("created_at")

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          Audit Trail
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!logs?.length ? (
          <p className="text-sm text-muted-foreground">No events recorded yet.</p>
        ) : (
          <div className="divide-y">
            {logs.map((log: any) => (
              <div key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                <span className={`px-1.5 py-0.5 rounded font-semibold capitalize shrink-0 ${actionStyle(log.action)}`}>
                  {log.action}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {new Date(log.created_at).toLocaleString("en-US", {
                    month: "short", day: "numeric", year: "numeric",
                    hour: "numeric", minute: "2-digit",
                  })}
                </span>
                {log.customer_email && (
                  <span className="text-foreground">{log.customer_email}</span>
                )}
                {log.ip_address && (
                  <span className="font-mono text-muted-foreground">{log.ip_address}</span>
                )}
                {log.user_agent && (
                  <span className="text-muted-foreground" title={log.user_agent}>
                    {parseBrowser(log.user_agent)}
                  </span>
                )}
                {(log.metadata as any)?.signer_name && (
                  <span className="text-foreground">
                    by {(log.metadata as any).signer_name}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
