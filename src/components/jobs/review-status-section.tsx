"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Star, Send, Loader2, CheckCircle2, Clock, CircleDashed, XCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"

interface TemplateShape {
  id: string
  name: string
  type: string
  subject: string | null
  body: string
}

interface Props {
  jobId: string
  reviewRequestedAt: string | null
  reviewCompleted: boolean
  templates: TemplateShape[]
  data: Record<string, string>
  logContext: { customerId?: string; jobId?: string }
  googleReviewLink: string | null
  customerEmail: string | null
}

function render(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? `{{${key}}}`)
}

export function ReviewStatusSection({
  jobId,
  reviewRequestedAt: initialRequestedAt,
  reviewCompleted: initialCompleted,
  templates,
  data,
  googleReviewLink,
  customerEmail,
}: Props) {
  const [requestedAt, setRequestedAt] = useState(initialRequestedAt)
  const [completed, setCompleted] = useState(initialCompleted)
  const [toggling, setToggling] = useState(false)
  const [sendOpen, setSendOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  const reviewTpl = templates.find((t) => t.type === "review_request")
  const [to, setTo] = useState(customerEmail ?? "")
  const [sendSubject, setSendSubject] = useState(
    reviewTpl?.subject ? render(reviewTpl.subject, data) : "We'd love your feedback!"
  )
  const [sendBody, setSendBody] = useState(reviewTpl ? render(reviewTpl.body, data) : "")

  async function handleSend() {
    if (!to) { toast({ title: "Recipient email required", variant: "destructive" }); return }
    setSending(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/review-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject: sendSubject, body: sendBody }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast({ title: "Failed to send", description: (d as any).error ?? "Unknown error", variant: "destructive" })
        return
      }
      const json = await res.json() as { review_requested_at?: string }
      if (json.review_requested_at && !requestedAt) {
        setRequestedAt(json.review_requested_at)
      }
      toast({ title: "Review request sent!", description: `Email sent to ${to}` })
      setSendOpen(false)
      router.refresh()
    } catch {
      toast({ title: "Failed to send", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  async function handleToggle() {
    setToggling(true)
    const action = completed ? "uncomplete" : "complete"
    try {
      const res = await fetch(`/api/jobs/${jobId}/review`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action }),
      })
      if (res.ok) {
        setCompleted(!completed)
        toast({ title: completed ? "Review status cleared" : "Review marked as completed!" })
        router.refresh()
      }
    } catch {
      toast({ title: "Error updating review status", variant: "destructive" })
    } finally {
      setToggling(false)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Star className="w-4 h-4 text-amber-500" />
            Review Request
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Status indicator */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              {completed ? (
                <>
                  <div className="w-9 h-9 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4.5 h-4.5 text-green-600 dark:text-green-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Review completed</p>
                    {requestedAt && (
                      <p className="text-xs text-muted-foreground">
                        Requested on {formatDate(requestedAt.split("T")[0])}
                      </p>
                    )}
                  </div>
                </>
              ) : requestedAt ? (
                <>
                  <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">
                      Requested on {formatDate(requestedAt.split("T")[0])}
                    </p>
                    <p className="text-xs text-muted-foreground">Waiting for customer to leave a review</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <CircleDashed className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Not requested yet</p>
                    <p className="text-xs text-muted-foreground">Send a review request email to the customer</p>
                  </div>
                </>
              )}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 flex-1 sm:flex-none"
                onClick={() => setSendOpen(true)}
              >
                <Send className="w-3.5 h-3.5" />
                Send Review Request
              </Button>

              <Button
                variant={completed ? "outline" : "default"}
                size="sm"
                className={`gap-1.5 flex-1 sm:flex-none ${!completed ? "bg-green-600 hover:bg-green-700 text-white border-green-600 hover:border-green-700 dark:bg-green-700 dark:hover:bg-green-600" : ""}`}
                onClick={handleToggle}
                disabled={toggling}
              >
                {toggling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : completed ? (
                  <XCircle className="w-3.5 h-3.5" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                {completed ? "Clear Review" : "Mark Review Completed"}
              </Button>
            </div>
          </div>

          {!googleReviewLink && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-3 pt-3 border-t border-border">
              No Google review link set.{" "}
              <a href="/settings" className="underline hover:no-underline">
                Add it in Company Settings
              </a>{" "}
              to include it in the review request template.
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog open={sendOpen} onOpenChange={setSendOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Send Review Request</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
              <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="customer@example.com" />
              {!customerEmail && <p className="text-xs text-warning">No email on file — enter one above.</p>}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
              <Input value={sendSubject} onChange={(e) => setSendSubject(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
              <Textarea value={sendBody} onChange={(e) => setSendBody(e.target.value)} className="min-h-[160px] text-sm" />
            </div>
            {!googleReviewLink && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No Google review link set — the email will send without a review button.{" "}
                <a href="/settings" className="underline hover:no-underline">Add it in Company Settings.</a>
              </p>
            )}
            {!reviewTpl && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                No "review_request" template found.{" "}
                <a href="/settings/templates" className="underline hover:no-underline">Create one in Settings</a>{" "}
                to pre-fill this message automatically.
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSendOpen(false)} disabled={sending}>Cancel</Button>
            <Button onClick={handleSend} disabled={sending || !to || !sendBody}>
              {sending
                ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
                : <><Send className="w-4 h-4 mr-1.5" />Send Review Request</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
