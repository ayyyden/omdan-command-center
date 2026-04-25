"use client"

import { useRef, useEffect } from "react"
import { Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"

// ── Bulk action bar ──────────────────────────────────────────────────────────

interface BulkBarProps {
  count: number
  entity: string
  onDelete: () => void
  onClear: () => void
  deleting?: boolean
}

export function BulkBar({ count, entity, onDelete, onClear, deleting }: BulkBarProps) {
  if (count === 0) return null
  const plural = count !== 1
  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-4 py-2">
      <span className="text-sm font-medium">
        {count} {entity}{plural ? "s" : ""} selected
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="h-7 px-2 text-muted-foreground"
        >
          <X className="w-3.5 h-3.5 mr-1" />Clear
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
          className="h-7"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete {count}
        </Button>
      </div>
    </div>
  )
}

// ── Header checkbox (supports indeterminate state) ───────────────────────────

interface HeaderCheckboxProps {
  allSelected: boolean
  someSelected: boolean
  onChange: (checked: boolean) => void
}

export function HeaderCheckbox({ allSelected, someSelected, onChange }: HeaderCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected
  }, [someSelected])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer accent-primary"
    />
  )
}
