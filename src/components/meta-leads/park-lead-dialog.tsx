"use client"

// "Put on Hold" / "Move to Follow-up" for a lead. Neither one texts or calls
// the customer; Follow-up only reminds the team on the date picked.

import { useEffect, useState } from "react"
import { fromZonedTime, formatInTimeZone } from "date-fns-tz"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import type { MetaLead } from "@/types"

const TZ = "America/Los_Angeles"

interface Props {
  lead: MetaLead
  list: "on_hold" | "follow_up" | null
  onOpenChange: (open: boolean) => void
  onUpdated: (lead: MetaLead) => void
}

export function ParkLeadDialog({ lead, list, onOpenChange, onUpdated }: Props) {
  const [note, setNote] = useState("")
  const [date, setDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!list) return
    setNote(lead.list === list ? (lead.list_note ?? "") : "")
    setDate(list === "follow_up" && lead.follow_up_at ? formatInTimeZone(new Date(lead.follow_up_at), TZ, "yyyy-MM-dd") : "")
    setError(null)
  }, [list, lead])

  const hasAppointment = lead.list === "scheduled" && !!lead.calendar_event_id
  const hasCallback = lead.list === "schedule_call_list" && !!lead.calendar_event_id

  async function save() {
    if (!list) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}/park`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list, note,
          follow_up_at: list === "follow_up" && date ? fromZonedTime(`${date}T09:00:00`, TZ).toISOString() : null,
        }),
      })
      const data = await res.json() as { lead?: MetaLead; error?: string }
      if (!res.ok || !data.lead) { setError(data.error ?? "Couldn't move the lead"); return }
      onUpdated(data.lead)
      onOpenChange(false)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!list} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{list === "on_hold" ? "Put on hold" : "Move to follow-up"}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {list === "on_hold"
            ? `${lead.full_name} stays on the On Hold list until you move them back.`
            : `${lead.full_name} goes on the Follow-up list, sorted by the date you pick.`}{" "}
          <b className="text-foreground">The client is not texted.</b>
        </p>
        {hasAppointment && (
          <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            Their estimate is taken off the Google Calendar, so no reminder text goes out.
          </p>
        )}
        {hasCallback && (
          <p className="text-sm text-muted-foreground">Their call-back reminder is removed from the calendar.</p>
        )}

        <div className="space-y-3">
          {list === "follow_up" && (
            <div className="space-y-1.5">
              <Label>Follow up on</Label>
              <DatePicker value={date} onChange={setDate} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Note (optional)</Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={list === "on_hold" ? "e.g. waiting on insurance" : "e.g. wants to start after the holidays"} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || (list === "follow_up" && !date)}>
            {saving ? "Saving…" : list === "on_hold" ? "Put on hold" : "Move to follow-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
