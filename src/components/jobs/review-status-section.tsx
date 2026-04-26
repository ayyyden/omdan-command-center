"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Star, Copy, Check, Loader2, CheckCircle2, Clock, CircleDashed, XCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { logCommunication, type LogCommunicationParams } from "@/lib/log-communication"
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
  logContext,
  googleReviewLink,
}: Props) {
  const [requestedAt, setRequestedAt] = useState(initialRequestedAt)
  const [completed, setCompleted] = useState(initialCompleted)
  const [copying, setCopying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [toggling, setToggling] = useState(false)
  const { toast } = useToast()
  const router = useRouter()

  async function handleCopy() {
    const template = templates.find((t) => t.type === "review_request")
    if (!template) {
      toast({
        title: "No review request template",
        description: "Create a 'review_request' template in Settings → Message Templates.",
        variant: "destructive",
      })
      return
    }

    const body    = render(template.body, data)
    const subject = template.subject ? render(template.subject, data) : null
    const text    = subject ? `${subject}\n\n${body}` : body

    setCopying(true)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)

      logCommunication({
        ...(logContext as LogCommunicationParams),
        templateId: template.id,
        type:       template.type,
        subject,
        body,
      }).catch(() => {})

      if (!requestedAt) {
        const res = await fetch(`/api/jobs/${jobId}/review`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ action: "request" }),
        })
        if (res.ok) {
          const json = await res.json() as { review_requested_at: string }
          setRequestedAt(json.review_requested_at)
        }
      }

      toast({
        title: "Review request copied!",
        description: googleReviewLink
          ? "Paste it into a text or email for the customer."
          : "Tip: add a Google review link in Company Settings.",
      })
    } catch {
      toast({ title: "Copy failed — try manually", variant: "destructive" })
    } finally {
      setCopying(false)
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
                  <p className="text-xs text-muted-foreground">Copy the review request message to send to the customer</p>
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
              onClick={handleCopy}
              disabled={copying}
            >
              {copying ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : copied ? (
                <Check className="w-3.5 h-3.5 text-success" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? "Copied!" : "Copy Review Request"}
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
  )
}
