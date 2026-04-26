"use client"

import { useState } from "react"
import { Download, ChevronDown } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Props {
  from?: string
  to?: string
  pm?: string
  status?: string
}

const EXPORTS = [
  { type: "payments",          label: "Payments",           description: "Collected payments log" },
  { type: "job_expenses",      label: "Job Expenses",       description: "Expenses tied to jobs" },
  { type: "overhead_expenses", label: "Business Overhead",  description: "Non-job operating costs" },
  { type: "expenses",          label: "All Expenses",       description: "Job + overhead combined" },
  { type: "invoices",          label: "Invoices",           description: "Status + balance per invoice" },
  { type: "job_profit",        label: "Job Profit Summary", description: "Per-job P&L breakdown" },
  { type: "receipts",          label: "Receipts",           description: "Uploaded receipt log" },
] as const

export function ExportSection({ from, to, pm, status }: Props) {
  const [open, setOpen] = useState(false)

  function buildUrl(type: string) {
    const p = new URLSearchParams({ type })
    if (from)                       p.set("from", from)
    if (to)                         p.set("to", to)
    if (pm && pm !== "all")         p.set("pm", pm)
    if (status && status !== "all") p.set("status", status)
    return `/api/reports/export?${p.toString()}`
  }

  const filterLabel = [from, to].filter(Boolean).join(" → ")

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-accent/40 transition-colors rounded-xl"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Download className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0">
            <span className="text-sm font-semibold text-foreground">Export for Accountant</span>
            <span className="hidden sm:inline text-xs text-muted-foreground ml-2">
              CSV downloads for payments, expenses, invoices &amp; more
              {filterLabel && (
                <span className="ml-1 font-medium text-foreground">{filterLabel}</span>
              )}
            </span>
          </div>
        </div>
        <ChevronDown
          className={cn(
            "w-4 h-4 text-muted-foreground shrink-0 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <CardContent className="pt-0 pb-4 px-4">
          <p className="text-xs text-muted-foreground mb-3 sm:hidden">
            CSV downloads · respects active filters
            {filterLabel && <span className="ml-1 font-medium text-foreground">{filterLabel}</span>}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
            {EXPORTS.map(({ type, label, description }) => (
              <a
                key={type}
                href={buildUrl(type)}
                download
                className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border bg-card hover:bg-accent hover:border-accent-foreground/20 active:scale-[0.97] transition-all group no-underline"
              >
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Download className="w-4 h-4 text-primary group-hover:translate-y-0.5 transition-transform" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5 truncate">{description}</p>
                </div>
              </a>
            ))}
          </div>
        </CardContent>
      )}
    </Card>
  )
}
