"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ExternalLink, RefreshCw, FileText, User, Briefcase, Trash2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export interface SentContract {
  id: string
  signing_token: string
  recipient_email: string
  status: string
  sent_at: string
  signed_at: string | null
  signer_name: string | null
  signed_pdf_path: string | null
  subject: string | null
  body: string | null
  contract_template: { id: string; name: string } | null
  customer: { id: string; name: string } | null
  job: { id: string; title: string } | null
}

interface Props {
  sent: SentContract[]
  appUrl: string
}

type Filter = "all" | "sent" | "signed"
const FILTERS: Filter[] = ["all", "sent", "signed"]

function fmtDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export function SentContractsTable({ sent, appUrl }: Props) {
  const { toast } = useToast()
  const router = useRouter()

  const [filter, setFilter] = useState<Filter>("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [resending, setResending] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const selectAllRef = useRef<HTMLInputElement>(null)

  const counts: Record<Filter, number> = {
    all: sent.length,
    sent: sent.filter((s) => s.status === "sent").length,
    signed: sent.filter((s) => s.status === "signed").length,
  }

  const rows = filter === "all" ? sent : sent.filter((s) => s.status === filter)
  const visibleIds = rows.map((r) => r.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const someSelected = visibleIds.some((id) => selected.has(id))
  const indeterminate = someSelected && !allSelected
  const selectedCount = visibleIds.filter((id) => selected.has(id)).length

  // Keep native indeterminate state in sync
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = indeterminate
    }
  }, [indeterminate])

  // Clear selection whenever filter changes
  useEffect(() => {
    setSelected(new Set())
  }, [filter])

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        visibleIds.forEach((id) => next.delete(id))
      } else {
        visibleIds.forEach((id) => next.add(id))
      }
      return next
    })
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleResend(s: SentContract) {
    setResending(s.id)
    const res = await fetch("/api/contracts/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentContractId: s.id }),
    })
    setResending(null)
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Resend failed", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }
    toast({ title: "Email resent", description: `Sent to ${s.recipient_email}` })
  }

  async function handleViewPdf(s: SentContract) {
    const res = await fetch(`/api/contracts/view-pdf/${s.id}`)
    if (!res.ok) {
      toast({ title: "Could not open PDF", variant: "destructive" })
      return
    }
    const { url } = await res.json()
    window.open(url, "_blank")
  }

  const selectedVisibleIds = visibleIds.filter((id) => selected.has(id))

  async function handleBulkDelete() {
    setDeleting(true)
    const res = await fetch("/api/contracts/bulk-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selectedVisibleIds }),
    })
    setDeleting(false)
    setConfirmOpen(false)

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      toast({ title: "Delete failed", description: err.error ?? "Unknown error", variant: "destructive" })
      return
    }

    setSelected(new Set())
    toast({ title: `${selectedVisibleIds.length} record${selectedVisibleIds.length !== 1 ? "s" : ""} deleted` })
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex items-center gap-1">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors capitalize ${
              filter === f
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            {f}{" "}
            <span className="text-xs ml-0.5 opacity-60">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-muted/40 text-sm">
          <span className="font-medium text-foreground">
            {selectedCount} selected
          </span>
          <div className="flex-1" />
          <Button
            size="sm"
            variant="destructive"
            className="gap-1.5 h-7 text-xs"
            onClick={() => setConfirmOpen(true)}
            aria-label={`Delete ${selectedCount} selected contract${selectedCount !== 1 ? "s" : ""} permanently`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Permanently
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No {filter === "all" ? "" : filter + " "}contracts found.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="px-4 py-3 w-8">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-border cursor-pointer"
                    aria-label="Select all visible rows"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Contract</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Customer</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Job</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Recipient</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Sent</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground whitespace-nowrap">Signed</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((s) => (
                <tr
                  key={s.id}
                  className={`transition-colors ${
                    selected.has(s.id) ? "bg-muted/50" : "hover:bg-muted/30"
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggleRow(s.id)}
                      className="rounded border-border cursor-pointer"
                      aria-label={`Select sent contract for ${s.contract_template?.name ?? "contract"} to ${s.recipient_email}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium max-w-[180px]">
                    <span className="truncate block">{s.contract_template?.name ?? "—"}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {s.customer?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {s.job?.title ?? <span className="opacity-40">—</span>}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground max-w-[180px]">
                    <span className="truncate block">{s.recipient_email}</span>
                  </td>
                  <td className="px-4 py-3">
                    {s.status === "signed" ? (
                      <Badge className="bg-green-100 text-green-700 border border-green-200 hover:bg-green-100">
                        Signed
                      </Badge>
                    ) : (
                      <Badge className="bg-amber-100 text-amber-700 border border-amber-200 hover:bg-amber-100">
                        Sent
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{fmtDate(s.sent_at)}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {s.signed_at ? (
                      <span>{fmtDate(s.signed_at)}</span>
                    ) : (
                      <span className="opacity-40">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-0.5">
                      {s.status !== "signed" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Open signing link"
                          aria-label="Open signing link"
                          onClick={() =>
                            window.open(`${appUrl}/sign-contract/${s.signing_token}`, "_blank")
                          }
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {s.status !== "signed" && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Resend email"
                          aria-label="Resend contract email"
                          disabled={resending === s.id}
                          onClick={() => handleResend(s)}
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${resending === s.id ? "animate-spin" : ""}`}
                          />
                        </Button>
                      )}
                      {s.status === "signed" && s.signed_pdf_path && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="View signed PDF"
                          aria-label="View signed PDF"
                          onClick={() => handleViewPdf(s)}
                        >
                          <FileText className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {s.customer && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="View customer"
                          aria-label={`View customer ${s.customer.name}`}
                          onClick={() => (window.location.href = `/customers/${s.customer!.id}`)}
                        >
                          <User className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {s.job && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="View job"
                          aria-label={`View job ${s.job.title}`}
                          onClick={() => (window.location.href = `/jobs/${s.job!.id}`)}
                        >
                          <Briefcase className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={(o) => { if (!deleting) setConfirmOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete {selectedCount} sent contract{selectedCount !== 1 ? "s" : ""}?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete{" "}
            <span className="font-medium text-foreground">
              {selectedCount} sent contract record{selectedCount !== 1 ? "s" : ""}
            </span>
            . Contract templates, customers, and jobs will not be affected. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
              className="gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {deleting ? "Deleting…" : "Delete Permanently"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
