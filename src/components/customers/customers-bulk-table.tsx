"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { InlineLeadStatus } from "@/components/customers/inline-lead-status"
import { BulkBar, HeaderCheckbox } from "@/components/shared/bulk-bar"
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog"
import { useSelection } from "@/hooks/use-selection"
import { useToast } from "@/hooks/use-toast"
import { formatDate, formatPhone } from "@/lib/utils"
import { Clock, UserPlus } from "lucide-react"
import Link from "next/link"
import type { LeadStatus } from "@/types"

const ACTIVE_STAGES = new Set<string>([
  "New Lead", "Contacted", "Estimate Sent", "Follow-Up Needed", "Approved",
])

const SOURCE_LABELS: Record<string, string> = {
  referral:        "Referral",
  google:          "Google",
  facebook:        "Facebook",
  instagram:       "Instagram",
  door_knock:      "Door Knock",
  repeat_customer: "Repeat",
  yard_sign:       "Yard Sign",
  nextdoor:        "Nextdoor",
  yelp:            "Yelp",
  other:           "Other",
}

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

interface CustomerRow {
  id: string
  name: string
  email: string | null
  phone: string | null
  service_type: string | null
  lead_source: string | null
  status: string
  created_at: string
  updated_at: string
}

interface Props {
  customers: CustomerRow[]
  userId: string
  lastContact: Record<string, string>
}

export function CustomersBulkTable({ customers, userId, lastContact }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const allIds = customers.map((c) => c.id)
  const { selected, toggle, toggleAll, clear, allSelected, someSelected } = useSelection(allIds)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    const supabase = createClient()
    const ids = Array.from(selected)
    const { error } = await supabase.from("customers").delete().in("id", ids)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: `Deleted ${ids.length} customer${ids.length !== 1 ? "s" : ""}` })
    clear()
    setConfirmOpen(false)
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <BulkBar
        count={selected.size}
        entity="customer"
        onDelete={() => setConfirmOpen(true)}
        onClear={clear}
        deleting={deleting}
      />

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 px-3">
                <HeaderCheckbox allSelected={allSelected} someSelected={someSelected} onChange={toggleAll} />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Service</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Last Contact</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-16">
                  <div className="flex flex-col items-center justify-center gap-3 text-center">
                    <UserPlus className="w-8 h-8 text-muted-foreground/40" />
                    <div>
                      <p className="font-medium text-muted-foreground">No leads yet</p>
                      <p className="text-sm text-muted-foreground/60 mt-0.5">Add your first customer or lead to get started.</p>
                    </div>
                    <Link href="/customers/new" className="text-sm font-medium text-primary hover:underline">
                      Add your first lead →
                    </Link>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              customers.map((c) => {
                const lc           = lastContact[c.id] ?? null
                const lastActivity = lc ?? c.updated_at
                const days         = daysSince(lastActivity)
                const isStale      = ACTIVE_STAGES.has(c.status) && days >= 7
                const isVeryStale  = ACTIVE_STAGES.has(c.status) && days >= 14

                return (
                  <TableRow
                    key={c.id}
                    className={
                      selected.has(c.id)  ? "bg-primary/5"           :
                      isVeryStale         ? "bg-destructive/[0.03]"   :
                      isStale             ? "bg-warning/[0.03]"        : ""
                    }
                  >
                    <TableCell className="px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={(e) => toggle(c.id, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </TableCell>
                    <TableCell>
                      <Link href={`/customers/${c.id}`} className="font-semibold hover:text-primary transition-colors">
                        {c.name}
                      </Link>
                      {c.email && <p className="text-xs text-muted-foreground mt-0.5">{c.email}</p>}
                    </TableCell>
                    <TableCell className="text-sm">{c.phone ? formatPhone(c.phone) : "—"}</TableCell>
                    <TableCell className="text-sm">{c.service_type ?? "—"}</TableCell>
                    <TableCell className="text-sm">
                      {c.lead_source ? (SOURCE_LABELS[c.lead_source] ?? c.lead_source) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        {isStale && (
                          <Clock className={[
                            "w-3.5 h-3.5 shrink-0",
                            isVeryStale ? "text-destructive" : "text-warning",
                          ].join(" ")} />
                        )}
                        <div>
                          <p className={[
                            "text-xs font-medium",
                            isVeryStale ? "text-destructive" : isStale ? "text-warning" : "text-muted-foreground",
                          ].join(" ")}>
                            {lc ? formatDate(lc) : "—"}
                          </p>
                          {isStale && (
                            <p className={["text-[10px]", isVeryStale ? "text-destructive" : "text-warning"].join(" ")}>
                              {days}d no contact
                            </p>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <InlineLeadStatus customerId={c.id} currentStatus={c.status as LeadStatus} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(c.created_at)}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      <ConfirmDeleteDialog
        open={confirmOpen}
        count={selected.size}
        entity="customer"
        onConfirm={handleDelete}
        onCancel={() => setConfirmOpen(false)}
        deleting={deleting}
      />
    </div>
  )
}
