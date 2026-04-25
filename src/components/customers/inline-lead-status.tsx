"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import type { LeadStatus } from "@/types"

const ALL_STATUSES: LeadStatus[] = [
  "New Lead", "Contacted", "Estimate Sent", "Follow-Up Needed",
  "Approved", "Scheduled", "In Progress", "Completed", "Paid", "Closed Lost",
]

interface InlineLeadStatusProps {
  customerId: string
  currentStatus: LeadStatus
}

export function InlineLeadStatus({ customerId, currentStatus }: InlineLeadStatusProps) {
  const [status, setStatus] = useState<LeadStatus>(currentStatus)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleChange(newStatus: LeadStatus) {
    if (newStatus === status || loading) return
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("customers").update({ status: newStatus }).eq("id", customerId)
    setLoading(false)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    setStatus(newStatus)
    router.refresh()
  }

  return (
    <Select value={status} onValueChange={(v) => handleChange(v as LeadStatus)} disabled={loading}>
      <SelectTrigger className="h-7 w-40 text-xs border-transparent bg-transparent hover:border-input hover:bg-background focus:border-input focus:bg-background transition-colors px-2">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALL_STATUSES.map((s) => (
          <SelectItem key={s} value={s} className="text-xs">
            {s}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
