"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[DashboardError]", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Failed to load this page. The issue has been logged.
      </p>
      <Button onClick={reset}>Retry</Button>
    </div>
  )
}
