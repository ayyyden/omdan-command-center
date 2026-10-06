"use client"

// "How it went" — the outcome of a lead's appointment, picked on each lead.
// NPG / PNS / Other move the lead to the Canceled list; Sold moves it on to
// Approved. Restore (on the Canceled list) puts it back in New Leads.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export const LEAD_OUTCOMES = ["NPG", "PNS", "OTHER", "SOLD"] as const
export type LeadOutcome = (typeof LEAD_OUTCOMES)[number]

export const OUTCOME_LABELS: Record<LeadOutcome, string> = {
  NPG:   "NPG",
  PNS:   "PNS",
  OTHER: "Other",
  SOLD:  "Sold",
}

export function isCanceledOutcome(o: string | null | undefined): boolean {
  return o === "NPG" || o === "PNS" || o === "OTHER"
}

export function HowItWentSelect({ customerId, name, current, className }: {
  customerId: string
  name: string
  current: string | null
  className?: string
}) {
  const [value, setValue] = useState<string>(current ?? "")
  const [saving, setSaving] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function choose(next: LeadOutcome) {
    if (next === value || saving) return
    setSaving(true)
    const { error } = await createClient()
      .from("customers")
      .update({
        lead_outcome:    next,
        lead_outcome_at: new Date().toISOString(),
        status:          next === "SOLD" ? "Approved" : "Closed Lost",
      })
      .eq("id", customerId)
    setSaving(false)
    if (error) {
      toast({ title: "Not saved", description: error.message, variant: "destructive" })
      return
    }
    setValue(next)
    toast(next === "SOLD"
      ? { title: "Marked sold", description: `${name} moved to Approved` }
      : { title: `Moved to Canceled (${OUTCOME_LABELS[next]})`, description: name })
    router.refresh()
  }

  return (
    <Select value={value || undefined} onValueChange={(v) => choose(v as LeadOutcome)} disabled={saving}>
      <SelectTrigger className={cn("h-8 w-[136px] text-xs", !value && "text-muted-foreground", className)} aria-label={`How it went for ${name}`}>
        <SelectValue placeholder="How it went" />
      </SelectTrigger>
      <SelectContent>
        {LEAD_OUTCOMES.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">
            {OUTCOME_LABELS[o]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
