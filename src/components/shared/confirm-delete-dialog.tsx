"use client"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, TriangleAlert } from "lucide-react"

interface ConfirmDeleteDialogProps {
  open: boolean
  count: number
  entity: string
  onConfirm: () => void
  onCancel: () => void
  deleting: boolean
}

export function ConfirmDeleteDialog({
  open, count, entity, onConfirm, onCancel, deleting,
}: ConfirmDeleteDialogProps) {
  const plural = count !== 1
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !deleting) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TriangleAlert className="w-5 h-5 text-destructive shrink-0" />
            Delete {count} {entity}{plural ? "s" : ""}?
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground py-1">
          {plural
            ? `These ${count} ${entity}s will be permanently deleted.`
            : `This ${entity} will be permanently deleted.`}{" "}
          <span className="font-semibold text-foreground">This cannot be undone.</span>
          {" "}Linked records may also be affected.
        </p>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={deleting}>
            {deleting && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
            Delete {count} {entity}{plural ? "s" : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
