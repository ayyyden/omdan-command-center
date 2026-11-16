"use client"

// Scheduler page: a customer who isn't ready (wants another time but doesn't
// know when, wants to think, or stopped answering). Takes the appointment off
// the Google Calendar and the booking sheet so the spot opens up, and puts them
// on the Follow-up or On Hold list on the Leads page. No text is sent.

import { useEffect, useState } from "react"
import { fromZonedTime } from "date-fns-tz"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

const TZ = "America/Los_Angeles"

interface Props {
  event: { id: string; title: string; when: string } | null
  onClose: () => void
  onDone: (eventId: string, list: "follow_up" | "on_hold") => void
}

export function ParkAppointmentDialog({ event, onClose, onDone }: Props) {
  const [list, setList] = useState<"follow_up" | "on_hold">("follow_up")
  const [date, setDate] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (event) { setList("follow_up"); setDate(""); setNote(""); setError(null) }
  }, [event])

  async function save() {
    if (!event) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/calendar/events/park", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_id: event.id, list, note,
          follow_up_at: list === "follow_up" && date ? fromZonedTime(`${date}T09:00:00`, TZ).toISOString() : null,
        }),
      })
      const data = await res.json() as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) { setError(data.error ?? "Couldn't move the appointment"); return }
      onDone(event.id, list)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={!!event} onOpenChange={(o) => { if (!o && !saving) onClose() }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Take off the calendar</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">{event?.title}</b> · {event?.when}
        </p>
        <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          The appointment is removed from the Google Calendar and the booking sheet, so the time is open to book again.
          <b> The customer is not texted.</b>
        </p>

        <div className="grid grid-cols-2 gap-2">
          {([["follow_up", "Follow up later"], ["on_hold", "Put on hold"]] as const).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setList(key)}
              className={cn("rounded-md border px-3 py-2 text-sm font-medium transition-colors",
                list === key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {label}
            </button>
          ))}
        </div>

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
              placeholder={list === "follow_up" ? "e.g. wants to reschedule, will decide next week" : "e.g. not sure, didn't answer"} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving || (list === "follow_up" && !date)}>
            {saving ? "Moving…" : list === "follow_up" ? "Move to Follow-up" : "Put on hold"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
