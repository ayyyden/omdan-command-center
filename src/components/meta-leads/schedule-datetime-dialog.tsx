"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"

interface ScheduleDateTimeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  loading?: boolean
  onConfirm: (whenISO: string) => void
}

export function ScheduleDateTimeDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  loading = false,
  onConfirm,
}: ScheduleDateTimeDialogProps) {
  const [date, setDate] = useState("") // YYYY-MM-DD
  const [time, setTime] = useState("09:00") // HH:MM (24h)

  function handleConfirm() {
    if (!date) return
    onConfirm(new Date(`${date}T${time}:00`).toISOString())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <div className="space-y-1.5">
            <Label>Time</Label>
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={loading || !date}>
            {loading ? "Saving…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
