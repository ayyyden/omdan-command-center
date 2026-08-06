"use client"

import { MetaLeadCard } from "@/components/meta-leads/meta-lead-card"
import type { MetaLead } from "@/types"

interface MetaLeadColumnProps {
  title: string
  leads: MetaLead[]
  emptyLabel: string
  onUpdated: (lead: MetaLead) => void
  onDeleted: (id: string) => void
}

export function MetaLeadColumn({ title, leads, emptyLabel, onUpdated, onDeleted }: MetaLeadColumnProps) {
  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex items-center justify-between px-1 pb-2 shrink-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-xs font-medium text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-2 pr-1 pb-2">
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
