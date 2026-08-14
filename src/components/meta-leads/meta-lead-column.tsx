"use client"

import { MetaLeadCard } from "@/components/meta-leads/meta-lead-card"
import { cn } from "@/lib/utils"
import type { MetaLead } from "@/types"

interface MetaLeadColumnProps {
  title: string
  leads: MetaLead[]
  emptyLabel: string
  onUpdated: (lead: MetaLead) => void
  onDeleted: (id: string) => void
  /** Single full-width lists (Scheduled/Archive tabs) don't need a mobile
   *  height cap — only the 3-stacked-columns Active tab does, so users can
   *  scroll past one section to reach the next without it eating the page. */
  noMobileCap?: boolean
}

export function MetaLeadColumn({ title, leads, emptyLabel, onUpdated, onDeleted, noMobileCap }: MetaLeadColumnProps) {
  return (
    <div className="flex flex-col min-h-0 md:h-full">
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className={cn(
        "overflow-y-auto space-y-2 pr-1 pb-2 md:flex-1 md:max-h-none",
        noMobileCap ? "max-h-none" : "max-h-[50vh]",
      )}>
        {leads.length === 0 ? (
          <p className="text-xs text-muted-foreground py-8 text-center">{emptyLabel}</p>
        ) : (
          leads.map((lead) => (
            <MetaLeadCard key={lead.id} lead={lead} onUpdated={onUpdated} onDeleted={onDeleted} />
          ))
        )}
      </div>
    </div>
  )
}
