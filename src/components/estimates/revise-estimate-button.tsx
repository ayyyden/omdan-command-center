"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { logActivity } from "@/lib/activity"
import { Button } from "@/components/ui/button"
import { CopyPlus, Loader2 } from "lucide-react"

interface ReviseEstimateButtonProps {
  estimateId: string
  userId: string
}

export function ReviseEstimateButton({ estimateId, userId }: ReviseEstimateButtonProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleRevise() {
    setLoading(true)
    const supabase = createClient()

    // Fetch the original estimate in full
    const { data: original, error: fetchError } = await supabase
      .from("estimates")
      .select("*")
      .eq("id", estimateId)
      .single()

    if (fetchError || !original) {
      toast({ title: "Could not load estimate", description: fetchError?.message, variant: "destructive" })
      setLoading(false)
      return
    }

    // Strip trailing " (Revised)" so repeated revisions don't stack the suffix
    const baseTitle = original.title.replace(/ \(Revised\)$/, "")

    const { data: newEst, error: insertError } = await supabase
      .from("estimates")
      .insert({
        user_id: userId,
        customer_id: original.customer_id,
        title: `${baseTitle} (Revised)`,
        scope_of_work: original.scope_of_work,
        line_items: original.line_items,
        markup_percent: original.markup_percent,
        tax_percent: original.tax_percent,
        subtotal: original.subtotal,
        markup_amount: original.markup_amount,
        tax_amount: original.tax_amount,
        total: original.total,
        notes: original.notes,
        status: "draft",
        revised_from_id: estimateId,
      })
      .select("id")
      .single()

    if (insertError || !newEst) {
      toast({ title: "Failed to create revision", description: insertError?.message, variant: "destructive" })
      setLoading(false)
      return
    }

    await logActivity(supabase, {
      userId,
      entityType: "estimate",
      entityId: newEst.id,
      action: "created",
      description: `Draft revision created from rejected estimate "${original.title}"`,
    })

    toast({ title: "Revision created", description: "Opening new draft for editing…" })
    router.push(`/estimates/${newEst.id}/edit`)
  }

  return (
    <Button variant="default" size="sm" onClick={handleRevise} disabled={loading} className="gap-1.5">
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <CopyPlus className="w-4 h-4" />
      )}
      Revise
    </Button>
  )
}
