"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Archive, Trash2, ArchiveRestore, Loader2 } from "lucide-react"

interface CustomerActionsProps {
  customerId: string
  customerName: string
  isArchived: boolean
}

export function CustomerActions({ customerId, customerName, isArchived }: CustomerActionsProps) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [loading, setLoading] = useState<"archive" | "delete" | null>(null)
  const router = useRouter()
  const { toast } = useToast()

  async function handleArchive() {
    setLoading("archive")
    const supabase = createClient()
    const { error } = await supabase
      .from("customers")
      .update({ is_archived: !isArchived })
      .eq("id", customerId)
    setLoading(null)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: isArchived ? "Customer restored" : "Customer archived", description: customerName })
    router.push("/customers")
    router.refresh()
  }

  async function handleDelete() {
    setLoading("delete")
    const supabase = createClient()
    const { error } = await supabase.from("customers").delete().eq("id", customerId)
    setLoading(null)
    if (error) {
      toast({ title: "Error deleting customer", description: error.message, variant: "destructive" })
      setConfirmDelete(false)
      return
    }
    toast({ title: "Customer deleted", description: `"${customerName}" has been permanently deleted.` })
    router.push("/customers")
    router.refresh()
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={handleArchive}
        disabled={loading !== null}
        className="gap-1.5"
      >
        {loading === "archive" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : isArchived ? (
          <ArchiveRestore className="w-4 h-4" />
        ) : (
          <Archive className="w-4 h-4" />
        )}
        {isArchived ? "Restore" : "Archive"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="gap-1.5 text-destructive hover:text-destructive"
        onClick={() => setConfirmDelete(true)}
        disabled={loading !== null}
      >
        <Trash2 className="w-4 h-4" />
        Delete
      </Button>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete Customer?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{customerName}"</span> and all their
            estimates, jobs, and history will be permanently deleted. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={loading === "delete"}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading === "delete"}>
              {loading === "delete" && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
