"use client"

import { useState } from "react"
import { Copy, Check, Phone, PhoneCall } from "lucide-react"
import { cn } from "@/lib/utils"

interface PhoneCopyButtonProps {
  phone: string
  className?: string
}

// Mobile-only — Quo's deep link opens their app directly to dial, but per
// Quo's own docs this scheme is mobile-app-only (falls back to the App/Play
// Store if Quo isn't installed) and isn't supported on desktop/web at all.
function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function PhoneCopyButton({ phone, className }: PhoneCopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const mobile = isMobileDevice()

  function handleClick() {
    if (mobile) {
      const from = process.env.NEXT_PUBLIC_QUO_FROM_NUMBER
      const params = new URLSearchParams({ number: phone, action: "call" })
      if (from) params.set("from", from)
      window.location.href = `openphone://dial?${params.toString()}`
      return
    }

    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      title={mobile ? "Call via Quo" : "Click to copy"}
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors",
        className
      )}
    >
      {mobile
        ? <PhoneCall className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        : <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
      <span>{phone}</span>
      {!mobile && (copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />)}
    </button>
  )
}
