"use client"

import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: "destructive" | "default"
  onConfirm: () => void
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            aria-label={cancelLabel}
          >
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={loading}
            aria-label={confirmLabel}
          >
            {loading ? "Loading…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
