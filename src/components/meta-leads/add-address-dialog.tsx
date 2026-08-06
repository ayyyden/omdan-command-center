"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { AddressAutocomplete } from "@/components/ui/address-autocomplete"
import type { MetaLead } from "@/types"

interface AddAddressDialogProps {
  lead: MetaLead
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (lead: MetaLead) => void
}

export function AddAddressDialog({ lead, open, onOpenChange, onSaved }: AddAddressDialogProps) {
  const [address, setAddress] = useState(lead.address ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      })
      const data = await res.json() as { lead?: MetaLead; error?: string }
      if (!res.ok || !data.lead) {
        setError(data.error ?? "Failed to save address")
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
          <DialogTitle>{lead.address ? "Edit address" : "Add address"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Address</Label>
          <AddressAutocomplete
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Start typing house number + street…"
          />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !address.trim()}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
