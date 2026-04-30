"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { MoreHorizontal, Archive, ArchiveRestore, Trash2, Loader2 } from "lucide-react"

interface Props {
  customerId: string
  customerName: string
  isArchived: boolean
}

export function CustomerMobileActions({ customerId, customerName, isArchived }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [archiving, setArchiving] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleArchive() {
    setArchiving(true)
    const { error } = await createClient().from("customers").update({ is_archived: !isArchived }).eq("id", customerId)
    setArchiving(false)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }
    toast({ title: isArchived ? "Customer restored" : "Customer archived" })
    router.push("/customers"); router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    const { error } = await createClient().from("customers").delete().eq("id", customerId)
    setDeleting(false)
    if (error) { toast({ title: "Error deleting customer", description: error.message, variant: "destructive" }); setDeleteOpen(false); return }
    toast({ title: "Customer deleted" }); router.push("/customers"); router.refresh()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="px-2.5" aria-label="More actions">
            <MoreHorizontal className="w-4 h-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={handleArchive} disabled={archiving}>
            {archiving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : isArchived ? <ArchiveRestore className="w-4 h-4 mr-2" /> : <Archive className="w-4 h-4 mr-2" />}
            {isArchived ? "Restore Customer" : "Archive Customer"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDeleteOpen(true)} className="text-destructive focus:text-destructive">
            <Trash2 className="w-4 h-4 mr-2" />Delete Customer
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Delete Customer?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{customerName}"</span> and all their estimates, jobs, and history will be permanently deleted.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
