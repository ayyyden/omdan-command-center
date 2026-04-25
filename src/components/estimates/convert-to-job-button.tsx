"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { ArrowRight, Loader2 } from "lucide-react"

interface ConvertToJobButtonProps {
  estimateId: string
  customerId: string
  estimateTitle: string
  userId: string
}

export function ConvertToJobButton({ estimateId, customerId, estimateTitle, userId }: ConvertToJobButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleConvert() {
    setLoading(true)
    const supabase = createClient()

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        user_id: userId,
        customer_id: customerId,
        estimate_id: estimateId,
        title: estimateTitle,
        status: "scheduled",
      })
      .select()
      .single()

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      setLoading(false)
      return
    }

    await supabase.from("activity_log").insert({
      user_id: userId,
      entity_type: "job",
      entity_id: job.id,
      action: "created",
      description: `Job created from estimate: ${estimateTitle}`,
    })

    toast({ title: "Job created", description: `"${estimateTitle}" converted to a job.` })
    setOpen(false)
    router.push(`/jobs/${job.id}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="success">
          <ArrowRight className="w-4 h-4 mr-2" />Convert to Job
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert Estimate to Job</DialogTitle>
          <DialogDescription>
            This will create a new job from <strong>{estimateTitle}</strong>. You can then schedule it, track expenses, and record payments.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleConvert} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Convert to Job
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
