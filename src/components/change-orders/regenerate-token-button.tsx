"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw, Loader2 } from "lucide-react"

interface Props {
  coId: string
  status: string
}

export function RegenerateTokenButton({ coId, status }: Props) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [loading, setLoading] = useState(false)

  // Approved/rejected orders have already been responded to — no point regenerating
  if (status === "approved" || status === "rejected") return null

  async function regenerate() {
    setLoading(true)
    await fetch(`/api/change-orders/${coId}/regenerate-token`, { method: "POST" })
    setLoading(false)
    setConfirming(false)
    router.refresh()
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">Invalidate old link?</span>
        <button
          onClick={regenerate}
          disabled={loading}
          className="text-destructive hover:underline font-medium disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Yes, regenerate"}
        </button>
        <span className="text-muted-foreground">·</span>
        <button
          onClick={() => setConfirming(false)}
          className="text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      title="Generate a new approval link — the old one stops working"
    >
      <RefreshCw className="w-3 h-3" />
      Regenerate Link
    </button>
  )
}
