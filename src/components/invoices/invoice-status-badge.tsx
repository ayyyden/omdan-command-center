import type { InvoiceStatus } from "@/types"

const STYLES: Record<InvoiceStatus, string> = {
  draft:   "bg-muted text-muted-foreground",
  sent:    "bg-warning/10 text-warning border border-warning/30",
  partial: "bg-primary/10 text-primary border border-primary/30",
  paid:    "bg-success/10 text-success border border-success/30",
}

const LABELS: Record<InvoiceStatus, string> = {
  draft:   "Draft",
  sent:    "Sent",
  partial: "Partial",
  paid:    "Paid",
}

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
