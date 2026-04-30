"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ShieldCheck, Loader2 } from "lucide-react"

interface AuditLog {
  id: string
  created_at: string
  action: string
  customer_name: string | null
  customer_email: string | null
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown> | null
}

function actionCls(action: string): string {
  const m: Record<string, string> = {
    viewed:   "bg-blue-50 text-blue-700",
    signed:   "bg-green-50 text-green-700",
    approved: "bg-green-50 text-green-700",
    declined: "bg-red-50 text-red-700",
  }
  return m[action] ?? "bg-gray-50 text-gray-700"
}

function parseBrowser(ua: string | null): string {
  if (!ua) return "—"
  if (/iPhone|iPad/i.test(ua))  return "iOS"
  if (/Android/i.test(ua))      return "Android"
  if (/Edg\//i.test(ua))        return "Edge"
  if (/Chrome/i.test(ua))       return "Chrome"
  if (/Firefox/i.test(ua))      return "Firefox"
  if (/Safari/i.test(ua))       return "Safari"
  return ua.slice(0, 20) + "…"
}

interface Props {
  documentType: "contract" | "estimate" | "change_order"
  documentId:   string
}

export function AuditDialog({ documentType, documentId }: Props) {
  const [open, setOpen]       = useState(false)
  const [logs, setLogs]       = useState<AuditLog[] | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setOpen(true)
    if (logs !== null) return
    setLoading(true)
    try {
      const res = await fetch(`/api/audit?documentType=${documentType}&documentId=${documentId}`)
      setLogs(res.ok ? await res.json() : [])
    } catch {
      setLogs([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        title="Audit trail"
        aria-label="View audit trail"
        onClick={load}
      >
        <ShieldCheck className="w-3.5 h-3.5" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="w-4 h-4" />
              Audit Trail
            </DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : !logs?.length ? (
            <p className="text-sm text-muted-foreground py-4">No events recorded yet.</p>
          ) : (
            <div className="divide-y pt-1">
              {logs.map((log) => (
                <div key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-xs">
                  <span className={`px-1.5 py-0.5 rounded font-semibold capitalize shrink-0 ${actionCls(log.action)}`}>
                    {log.action}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {new Date(log.created_at).toLocaleString("en-US", {
                      month: "short", day: "numeric", year: "numeric",
                      hour: "numeric", minute: "2-digit",
                    })}
                  </span>
                  {log.customer_email && <span>{log.customer_email}</span>}
                  {log.ip_address && (
                    <span className="font-mono text-muted-foreground">{log.ip_address}</span>
                  )}
                  {log.user_agent && (
                    <span className="text-muted-foreground" title={log.user_agent}>
                      {parseBrowser(log.user_agent)}
                    </span>
                  )}
                  {(log.metadata as any)?.signer_name && (
                    <span>by {(log.metadata as any).signer_name as string}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
