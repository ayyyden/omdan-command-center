"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2, Link2, AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Props {
  memberId: string
  pmId: string
  pmName: string
  matchedBy: "user_id" | "email"
}

export function LinkPmBanner({ memberId, pmId, pmName, matchedBy }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [linked, setLinked] = useState(false)

  async function handleLink() {
    setLoading(true)
    try {
      const res = await fetch(`/api/team/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_manager_id: pmId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({ title: "Error", description: data.error ?? "Failed to link", variant: "destructive" })
        return
      }
      setLinked(true)
      toast({ title: "PM profile linked successfully" })
      router.refresh()
    } catch {
      toast({ title: "Unexpected error. Please try again.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  if (linked) return null

  return (
    <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-900/10">
      <CardContent className="pt-4 pb-4 px-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
              PM profile not directly linked
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Found <strong>{pmName}</strong> by {matchedBy === "user_id" ? "user account" : "email"} match.
              Stats are shown using this record — link it permanently to fix this.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0 border-amber-500/40 text-amber-700 hover:bg-amber-100 dark:text-amber-400"
            onClick={handleLink}
            disabled={loading}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
            <span className="ml-1.5">Link</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
