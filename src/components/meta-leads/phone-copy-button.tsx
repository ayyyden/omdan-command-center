"use client"

import { useState } from "react"
import { Copy, Check, Phone } from "lucide-react"
import { cn } from "@/lib/utils"

interface PhoneCopyButtonProps {
  phone: string
  className?: string
}

export function PhoneCopyButton({ phone, className }: PhoneCopyButtonProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(phone).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Click to copy"
      className={cn(
        "inline-flex items-center gap-1.5 text-sm text-foreground hover:text-primary transition-colors",
        className
      )}
    >
      <Phone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
      <span>{phone}</span>
      {copied
        ? <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
        : <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
    </button>
  )
}
