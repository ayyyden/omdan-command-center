"use client"

import { useState } from "react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ScheduleDateTimeDialog } from "@/components/meta-leads/schedule-datetime-dialog"
import { PhoneCall, ChevronDown } from "lucide-react"
import type { MetaLead, MetaLeadOutcome } from "@/types"

interface OutcomeMenuProps {
  lead: MetaLead
  onUpdated: (lead: MetaLead) => void
  onDeleted: (id: string) => void
}

export function OutcomeMenu({ lead, onUpdated, onDeleted }: OutcomeMenuProps) {
  const [pending, setPending] = useState<"answered_scheduled" | "callback_later" | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function postOutcome(outcome: MetaLeadOutcome, scheduled_at?: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, scheduled_at }),
      })
      const data = await res.json() as { lead?: MetaLead; error?: string }
      if (!res.ok || !data.lead) {
        setError(data.error ?? "Failed to update lead")
        return
      }
      onUpdated(data.lead)
      setPending(null)
    } catch {
      setError("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/meta-leads/${lead.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? "Failed to delete lead")
        return
      }
      onDeleted(lead.id)
      setConfirmDelete(false)
    } catch {
      setError("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 w-full justify-between">
            <span className="flex items-center gap-1.5">
              <PhoneCall className="w-3.5 h-3.5" />
              Log outcome
            </span>
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={() => setPending("answered_scheduled")}>
            Answered &amp; Scheduled
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => postOutcome("no_answer")}>
            No Answer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPending("callback_later")}>
            Call Back Later
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            Answered &amp; Not Interested
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && <p className="text-xs text-destructive mt-1.5">{error}</p>}

      <ScheduleDateTimeDialog
        open={pending === "answered_scheduled"}
        onOpenChange={(o) => !o && setPending(null)}
        title="Schedule appointment"
        description="Pick when this appointment should be added to the main calendar."
        confirmLabel="Schedule"
        loading={loading}
        onConfirm={(whenISO) => postOutcome("answered_scheduled", whenISO)}
      />

      <ScheduleDateTimeDialog
        open={pending === "callback_later"}
        onOpenChange={(o) => !o && setPending(null)}
        title="Call back later"
        description="Pick when to call this lead back. It'll be added to the callback calendar."
        confirmLabel="Save"
        loading={loading}
        onConfirm={(whenISO) => postOutcome("callback_later", whenISO)}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this lead?"
        description="Are you sure you want to delete this lead? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        loading={loading}
        onConfirm={handleDelete}
      />
    </>
  )
}
