"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

interface BackButtonProps {
  fallback?: string
}

export function BackButton({ fallback = "/dashboard" }: BackButtonProps) {
  const router = useRouter()

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back()
    } else {
      router.push(fallback)
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleBack}
      aria-label="Go back"
      className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0"
    >
      <ArrowLeft className="w-4 h-4" />
    </Button>
  )
}
