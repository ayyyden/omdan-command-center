"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[RootError]", error)
  }, [error])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold text-foreground">Something went wrong</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        An unexpected error occurred. The issue has been logged.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
