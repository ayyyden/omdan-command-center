"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { formatDate } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Check, Trash2, Loader2 } from "lucide-react"
import Link from "next/link"

interface ReminderRowProps {
  id: string
  title: string
  due_date: string
  customerName?: string
  href: string | null
}

function addDays(date: string, days: number): string {
  const d = new Date(date + "T12:00:00")
  d.setDate(d.getDate() + days)
  return d.toISOString().split("T")[0]
}

export function ReminderRow({ id, title, due_date, customerName, href }: ReminderRowProps) {
  const [loading, setLoading] = useState<"done" | "snooze" | "delete" | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleDone() {
    setLoading("done")
    const supabase = createClient()
    const { error } = await supabase
      .from("reminders")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", id)
    setLoading(null)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    router.refresh()
  }

  async function handleSnooze(days: number) {
    setLoading("snooze")
    const supabase = createClient()
    const { error } = await supabase
      .from("reminders")
      .update({ due_date: addDays(due_date, days) })
      .eq("id", id)
    setLoading(null)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Snoozed ${days === 7 ? "1 week" : `${days} day${days > 1 ? "s" : ""}`}` })
    router.refresh()
  }

  async function handleDeleteConfirmed() {
    setLoading("delete")
    const supabase = createClient()
    const { error } = await supabase.from("reminders").delete().eq("id", id)
    setLoading(null)
    setConfirmOpen(false)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    router.refresh()
  }

  const busy = loading !== null

  return (
    <>
      <div className="flex items-center gap-2 -mx-2 px-2 py-1.5 rounded-md group hover:bg-warning/10 transition-colors">
        <div className="flex-1 min-w-0">
          {href ? (
            <Link href={href} className="block">
              <p className="text-sm font-medium truncate hover:text-primary transition-colors">{title}</p>
              {customerName && <p className="text-xs text-muted-foreground">{customerName}</p>}
            </Link>
          ) : (
            <>
              <p className="text-sm font-medium truncate">{title}</p>
              {customerName && <p className="text-xs text-muted-foreground">{customerName}</p>}
            </>
          )}
        </div>

        <Badge variant="warning" className="shrink-0 text-xs">{formatDate(due_date)}</Badge>

        <div className="flex items-center gap-0.5 shrink-0">
          {([1, 2, 7] as const).map((days) => (
            <Button
              key={days}
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => handleSnooze(days)}
              disabled={busy}
              aria-label={`Snooze ${days === 7 ? "1 week" : `${days} day${days > 1 ? "s" : ""}`}`}
              title={`Snooze ${days === 7 ? "1 week" : `${days} day${days > 1 ? "s" : ""}`}`}
            >
              {days === 7 ? "+1w" : `+${days}d`}
            </Button>
          ))}
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-success shrink-0"
          onClick={handleDone}
          disabled={busy}
          aria-label="Mark reminder done"
          title="Mark done"
        >
          {loading === "done" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
        </Button>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => setConfirmOpen(true)}
          disabled={busy}
          aria-label="Delete reminder"
          title="Delete reminder"
        >
          {loading === "delete" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Delete reminder?"
        description="This will permanently delete this reminder. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirmed}
        loading={loading === "delete"}
      />
    </>
  )
}
