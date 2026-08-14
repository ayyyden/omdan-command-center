"use client"

import { useState } from "react"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuPortal,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { ScheduleDateTimeDialog } from "@/components/meta-leads/schedule-datetime-dialog"
import { buildNoAnswerSms, type SmsLanguage } from "@/lib/meta-lead-sms"
import { PhoneCall, ChevronDown, ChevronRight, Check } from "lucide-react"
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
  const [smsNotice, setSmsNotice] = useState<string | null>(null)

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

  async function handleNoAnswer(language: SmsLanguage) {
    // First miss of this call cycle (not already sitting in Second Call List)
    // — send the follow-up text via Quo. Pressing No Answer again on a lead
    // already in Second Call List doesn't re-send (already texted once
    // this cycle).
    const isFirstMiss = lead.list !== "second_call_list"
    if (isFirstMiss) {
      try {
        const res = await fetch(`/api/meta-leads/${lead.id}/no-answer-sms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language }),
        })
        const data = await res.json() as { ok?: boolean; error?: string; text?: string }
        if (res.ok && data.ok) {
          setSmsNotice(`Text sent via Quo (${language === "es" ? "Español" : "English"})`)
        } else {
          // Quo not configured / send failed — fall back to clipboard so the
          // follow-up still goes out, just manually.
          const text = data.text ?? buildNoAnswerSms(lead.full_name, language)
          await navigator.clipboard.writeText(text)
          setSmsNotice(`Couldn't send automatically (${data.error ?? "unknown error"}) — copied to clipboard instead`)
        }
      } catch {
        const text = buildNoAnswerSms(lead.full_name, language)
        await navigator.clipboard.writeText(text)
        setSmsNotice("Couldn't send automatically — copied to clipboard instead")
      }
      setTimeout(() => setSmsNotice(null), 5000)
    }
    postOutcome("no_answer")
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
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="flex items-center justify-between">
              No Answer
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem onClick={() => handleNoAnswer("en")}>
                  English
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleNoAnswer("es")}>
                  Español
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
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

      {smsNotice && (
        <p className="text-xs text-green-600 dark:text-green-400 mt-1.5 flex items-center gap-1">
          <Check className="w-3 h-3" />
          {smsNotice}
        </p>
      )}
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
