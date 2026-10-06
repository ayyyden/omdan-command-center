"use client"

// The Canceled list: leads marked NPG / PNS / Other under "How it went".
// Pick rows (or Select all) and export them to a CSV file; Restore sends a
// lead back to New Leads if it was marked by mistake.

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, RotateCcw, XCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { HeaderCheckbox } from "@/components/shared/bulk-bar"
import { Button } from "@/components/ui/button"
import { useSelection } from "@/hooks/use-selection"
import { useToast } from "@/hooks/use-toast"
import { cn, formatDate, formatPhone } from "@/lib/utils"
import { OUTCOME_LABELS, type LeadOutcome } from "./lead-outcome"

export interface CanceledLead {
  id:              string
  name:            string
  address:         string | null
  phone:           string | null
  service_type:    string | null
  lead_outcome:    string | null
  lead_outcome_at: string | null
  updated_at:      string
}

function outcomeLabel(o: string | null): string {
  return o && o in OUTCOME_LABELS ? OUTCOME_LABELS[o as LeadOutcome] : "—"
}

function csvCell(v: string | null | undefined): string {
  const s = (v ?? "").replace(/\r?\n/g, " ")
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function downloadCsv(rows: CanceledLead[]) {
  const header = ["Full name", "Address", "Phone number", "Job type", "How it went"]
  const lines = [
    header.join(","),
    ...rows.map((r) => [r.name, r.address, r.phone ? formatPhone(r.phone) : "", r.service_type, outcomeLabel(r.lead_outcome)].map(csvCell).join(",")),
  ]
  // BOM so Excel opens accented names correctly
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = `canceled-leads-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function CanceledLeadsTable({ leads }: { leads: CanceledLead[] }) {
  const router = useRouter()
  const { toast } = useToast()
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(leads.map((l) => l.id))
  const [restoring, setRestoring] = useState<string | null>(null)

  const chosen = leads.filter((l) => selected.has(l.id))

  function exportCsv() {
    if (!chosen.length) return
    downloadCsv(chosen)
    toast({ title: `Exported ${chosen.length} lead${chosen.length !== 1 ? "s" : ""}` })
  }

  async function restore(lead: CanceledLead) {
    setRestoring(lead.id)
    const { error } = await createClient()
      .from("customers")
      .update({ status: "New Lead", lead_outcome: null, lead_outcome_at: null })
      .eq("id", lead.id)
    setRestoring(null)
    if (error) {
      toast({ title: "Not restored", description: error.message, variant: "destructive" })
      return
    }
    toggle(lead.id, false)
    toast({ title: "Back in New Leads", description: lead.name })
    router.refresh()
  }

  if (leads.length === 0) {
    return (
      <div className="rounded-lg border bg-card flex flex-col items-center justify-center gap-2 py-16 text-center">
        <XCircle className="w-8 h-8 text-muted-foreground/40" />
        <p className="font-medium text-muted-foreground">No canceled leads</p>
        <p className="text-sm text-muted-foreground/70 max-w-xs">Leads you mark NPG, PNS or Other under “How it went” show up here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Export bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
        <Button variant="outline" size="sm" onClick={() => toggleAll(!allSelected)}>
          {allSelected ? "Clear selection" : `Select all ${leads.length}`}
        </Button>
        <span className="text-sm text-muted-foreground">
          {selected.size ? `${selected.size} selected` : "Pick the leads to export, or select all"}
        </span>
        <Button size="sm" className="ml-auto" onClick={exportCsv} disabled={!selected.size}>
          <Download className="w-4 h-4" />
          Export CSV{selected.size ? ` (${selected.size})` : ""}
        </Button>
        {selected.size > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>
        )}
      </div>

      {/* Phone: cards */}
      <div className="sm:hidden space-y-2">
        {leads.map((l) => (
          <label
            key={l.id}
            className={cn("rounded-lg border bg-card p-3 flex gap-3 cursor-pointer", selected.has(l.id) && "border-primary/50 bg-primary/5")}
          >
            <input
              type="checkbox"
              checked={selected.has(l.id)}
              onChange={(e) => toggle(l.id, e.target.checked)}
              className="h-5 w-5 accent-primary mt-0.5 shrink-0"
            />
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/customers/${l.id}`} className="font-semibold leading-tight hover:text-primary">{l.name}</Link>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{outcomeLabel(l.lead_outcome)}</span>
              </div>
              {l.address && <p className="text-sm text-muted-foreground">{l.address}</p>}
              <p className="text-sm text-muted-foreground">
                {[l.phone ? formatPhone(l.phone) : null, l.service_type].filter(Boolean).join("  ·  ")}
              </p>
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); restore(l) }}
                disabled={restoring === l.id}
                className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore to new leads
              </button>
            </div>
          </label>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden sm:block rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 px-3">
                <HeaderCheckbox allSelected={allSelected} someSelected={someSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>Full name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>Phone number</TableHead>
              <TableHead>Job type</TableHead>
              <TableHead>How it went</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((l) => (
              <TableRow key={l.id} className={selected.has(l.id) ? "bg-primary/5" : ""}>
                <TableCell className="px-3">
                  <input
                    type="checkbox"
                    checked={selected.has(l.id)}
                    onChange={(e) => toggle(l.id, e.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                    aria-label={`Select ${l.name}`}
                  />
                </TableCell>
                <TableCell>
                  <Link href={`/customers/${l.id}`} className="font-semibold hover:text-primary">{l.name}</Link>
                </TableCell>
                <TableCell className="text-sm">{l.address ?? "—"}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">{l.phone ? formatPhone(l.phone) : "—"}</TableCell>
                <TableCell className="text-sm">{l.service_type ?? "—"}</TableCell>
                <TableCell className="text-sm whitespace-nowrap">
                  <span className="font-medium">{outcomeLabel(l.lead_outcome)}</span>
                  <span className="block text-xs text-muted-foreground">{formatDate(l.lead_outcome_at ?? l.updated_at)}</span>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => restore(l)} disabled={restoring === l.id} title="Move back to New Leads">
                    <RotateCcw className="w-3.5 h-3.5" /> Restore
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
