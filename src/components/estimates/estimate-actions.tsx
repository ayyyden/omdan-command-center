"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Trash2, Loader2 } from "lucide-react"

interface EstimateActionsProps {
  estimateId: string
  estimateTitle: string
}

export function EstimateActions({ estimateId, estimateTitle }: EstimateActionsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("estimates").delete().eq("id", estimateId)
    setLoading(false)
    if (error) {
      toast({ title: "Error deleting estimate", description: error.message, variant: "destructive" })
      setConfirmDelete(false)
      return
    }
    toast({ title: "Estimate deleted", description: `"${estimateTitle}" has been permanently deleted.` })
    router.push("/estimates")
    router.refresh()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Estimate?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{estimateTitle}"</span> will be permanently
            deleted. Any jobs created from this estimate will remain intact.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={loading}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
