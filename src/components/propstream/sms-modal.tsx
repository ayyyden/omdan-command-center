"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Button }   from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label }    from "@/components/ui/label"
import { NO_ANSWER_SMS } from "./sms-defaults"
import { CheckCircle2, AlertCircle } from "lucide-react"

interface Props {
  open:     boolean
  onClose:  () => void
  leadId:   string
  phoneId:  string
  toPhone:  string
  ownerName: string
}

export function SmsModal({ open, onClose, leadId, phoneId, toPhone, ownerName }: Props) {
  const [body,    setBody]    = useState(NO_ANSWER_SMS)
  const [loading, setLoading] = useState(false)
  const [sent,    setSent]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function handleSend() {
    setLoading(true)
    setError(null)
    const res = await fetch("/api/propstream/sms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: leadId, phone_id: phoneId, to_phone: toPhone, message: body }),
    })
    const data = await res.json()
    setLoading(false)
    if (!res.ok) { setError(data.error ?? "Send failed"); return }
    setSent(true)
  }

  function handleClose() {
    setSent(false)
    setError(null)
    setBody(NO_ANSWER_SMS)
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send SMS to {ownerName}</DialogTitle>
        </DialogHeader>

        {sent ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="font-medium">Message sent</p>
            <p className="text-sm text-muted-foreground">{toPhone}</p>
            <Button onClick={handleClose}>Done</Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label>To: {toPhone}</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={5}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">{body.length} chars</p>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSend} disabled={loading || !body.trim()}>
                {loading ? "Sending…" : "Send SMS"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
