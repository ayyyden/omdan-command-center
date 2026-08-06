"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { MetaLead } from "@/types"

interface EditLeadDialogProps {
  lead: MetaLead
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (lead: MetaLead) => void
}

export function EditLeadDialog({ lead, open, onOpenChange, onSaved }: EditLeadDialogProps) {
  const [fullName, setFullName] = useState(lead.full_name)
  const [email, setEmail] = useState(lead.email ?? "")
  const [phone, setPhone] = useState(lead.phone ?? "")
  const [city, setCity] = useState(lead.city ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!fullName.trim()) {
      setError("Full name is required")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ full_name: fullName, email, phone, city }),
      })
      const data = await res.json() as { lead?: MetaLead; error?: string }
      if (!res.ok || !data.lead) {
        setError(data.error ?? "Failed to save changes")
        return
      }
      onSaved(data.lead)
      onOpenChange(false)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edit lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Full name</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>City</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !fullName.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
