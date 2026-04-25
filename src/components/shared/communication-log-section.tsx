import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageSquare } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface CommLog {
  id: string
  created_at: string
  type: string
  subject: string | null
  body: string
  channel: string
}

const TYPE_LABELS: Record<string, string> = {
  estimate_follow_up: "Estimate Follow-up",
  job_scheduled:      "Job Scheduled",
  job_reminder:       "Job Reminder",
  payment_reminder:   "Payment Reminder",
  review_request:     "Review Request",
  custom:             "Custom",
}

export function CommunicationLogSection({ logs }: { logs: CommLog[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageSquare className="w-4 h-4" />
          Communication Log ({logs.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages logged yet.</p>
        ) : (
          <div className="divide-y divide-border/50">
            {logs.map((log) => (
              <div key={log.id} className="py-3 first:pt-0 last:pb-0 space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {TYPE_LABELS[log.type] ?? log.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {log.channel.replace(/_/g, " ")}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(log.created_at)}</span>
                </div>
                {log.subject && (
                  <p className="text-xs font-medium text-muted-foreground">{log.subject}</p>
                )}
                <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">{log.body}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
