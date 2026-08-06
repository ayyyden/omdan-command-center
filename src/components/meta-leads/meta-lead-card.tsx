"use client"

import { useState } from "react"
import { Mail, MapPin, Pencil, Trash2, Home, CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { PhoneCopyButton } from "@/components/meta-leads/phone-copy-button"
import { EditLeadDialog } from "@/components/meta-leads/edit-lead-dialog"
import { AddAddressDialog } from "@/components/meta-leads/add-address-dialog"
import { OutcomeMenu } from "@/components/meta-leads/outcome-menu"
import type { MetaLead } from "@/types"

interface MetaLeadCardProps {
  lead: MetaLead
  onUpdated: (lead: MetaLead) => void
  onDeleted: (id: string) => void
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  })
}

export function MetaLeadCard({ lead, onUpdated, onDeleted }: MetaLeadCardProps) {
  const [editOpen, setEditOpen] = useState(false)
  const [addressOpen, setAddressOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? "Failed to delete lead")
        return
      }
      onDeleted(lead.id)
    } catch {
      setError("Network error — please try again")
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const when = formatDateTime(lead.scheduled_at)

  return (
    <div className="rounded-xl border bg-card shadow-sm p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm text-foreground leading-tight">{lead.full_name}</p>
        <div className="flex items-center gap-0.5 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit" onClick={() => setEditOpen(true)}>
            <Pencil className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" title="Delete" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {lead.phone && <PhoneCopyButton phone={lead.phone} />}
        {lead.email && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Mail className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{lead.email}</span>
          </div>
        )}
        {lead.city && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>{lead.city}</span>
          </div>
        )}
        {lead.address && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Home className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{lead.address}</span>
          </div>
        )}
        {when && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClock className="w-3.5 h-3.5 shrink-0" />
            <span>{when}</span>
          </div>
        )}
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={() => setAddressOpen(true)}>
        {lead.address ? "Edit Address" : "Add Address"}
      </Button>

      <OutcomeMenu lead={lead} onUpdated={onUpdated} onDeleted={onDeleted} />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <EditLeadDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} onSaved={onUpdated} />
      <AddAddressDialog lead={lead} open={addressOpen} onOpenChange={setAddressOpen} onSaved={onUpdated} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lead?"
        description="Are you sure you want to delete this lead? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={handleDelete}
      />
    </div>
  )
}
