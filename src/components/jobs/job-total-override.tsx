"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Pencil, X, Check } from "lucide-react"

interface JobTotalOverrideProps {
  jobId: string
  calculatedTotal: number
  manualTotal: number | null
}

export function JobTotalOverride({ jobId, calculatedTotal, manualTotal }: JobTotalOverrideProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(manualTotal !== null ? String(manualTotal) : String(calculatedTotal))
  const [saving, setSaving] = useState(false)

  async function save() {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" })
      return
    }
    setSaving(true)
    const { error } = await createClient().from("jobs").update({ manual_total: num }).eq("id", jobId)
    if (error) {
      toast({ title: "Error saving", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "Total overridden" })
      setEditing(false)
      router.refresh()
    }
    setSaving(false)
  }

  async function clear() {
    setSaving(true)
    const { error } = await createClient().from("jobs").update({ manual_total: null }).eq("id", jobId)
    if (error) {
      toast({ title: "Error clearing", description: error.message, variant: "destructive" })
    } else {
      toast({ title: "Override cleared" })
      setValue(String(calculatedTotal))
      setEditing(false)
      router.refresh()
    }
    setSaving(false)
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className="text-xs text-muted-foreground">$</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 w-28 text-sm px-2"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") save()
            if (e.key === "Escape") setEditing(false)
          }}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={save} disabled={saving}>
          <Check className="w-3.5 h-3.5 text-success" />
        </Button>
        <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" onClick={() => setEditing(false)}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 mt-0.5">
      <button
        onClick={() => { setValue(String(manualTotal ?? calculatedTotal)); setEditing(true) }}
        className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Pencil className="w-2.5 h-2.5" />
        Edit total
      </button>
      {manualTotal !== null && (
        <>
          <span className="text-[10px] text-muted-foreground">·</span>
          <button
            onClick={clear}
            disabled={saving}
            className="flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="w-2.5 h-2.5" />
            Clear override
          </button>
        </>
      )}
    </div>
  )
}
