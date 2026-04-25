"use client"

import { BackButton } from "@/components/shared/back-button"

interface TopbarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function Topbar({ title, subtitle, actions }: TopbarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-card">
      <div className="flex items-center gap-2 min-w-0">
        <BackButton />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 ml-4">{actions}</div>}
    </div>
  )
}
