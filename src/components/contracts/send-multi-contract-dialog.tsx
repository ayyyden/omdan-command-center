"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { createClient } from "@/lib/supabase/client"
import { FileText, Loader2, ChevronRight } from "lucide-react"
import { DocumentActionSheet, type DocumentSummary } from "./document-action-sheet"

interface ContractTemplate {
  id: string
  name: string
}

interface Props {
  contracts: ContractTemplate[]
  customerId: string
  jobId: string
  customerEmail: string | null
  customerName: string
  companyName: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Job page "Send Contracts": pick the documents in signing order, then the
// same flow as the Documents page — fill your part of each, then Send by
// Email (one link, the customer agrees once and signs them in order, each
// shown already filled with your part) or Sign Now in person. Customer and
// job are already known here, so no recipient picking.
export function SendMultiContractDialog({
  contracts, customerId, jobId, customerEmail, customerName, companyName, open, onOpenChange,
}: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [sheetDocs, setSheetDocs] = useState<DocumentSummary[] | null>(null)
  const [userId, setUserId] = useState("")

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleContinue() {
    setLoading(true)
    const supabase = createClient()
    const [{ data: { user } }, { data: templates }, { data: pairs }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("contract_templates").select("id, name, requires_signature").in("id", selected),
      supabase.from("contract_templates").select("id, attached_to_template_id").in("attached_to_template_id", selected),
    ])
    setLoading(false)
    setUserId(user?.id ?? "")
    setSheetDocs(selected.map((id) => {
      const t = (templates ?? []).find((x) => x.id === id)
      const p = (pairs ?? []).find((x) => x.attached_to_template_id === id)
      return {
        id, name: t?.name ?? contracts.find((c) => c.id === id)?.name ?? "Contract",
        requiresSignature: t?.requires_signature ?? true,
        hasPairedDoc: !!p, pairedTemplateId: p?.id ?? null,
      }
    }))
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o && !sheetDocs) setSelected([]) }}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Send Contracts</DialogTitle>
          </DialogHeader>

          <div className="space-y-1.5 pt-1">
            <p className="text-xs font-medium text-muted-foreground">Tap documents in the order the customer should sign them</p>
            <div className="rounded-lg border divide-y">
              {contracts.map((c) => {
                const pos = selected.indexOf(c.id)
                return (
                  <button key={c.id} type="button" onClick={() => toggle(c.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors ${
                      pos !== -1 ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                      {pos !== -1 ? pos + 1 : null}
                    </div>
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{c.name}</span>
                  </button>
                )
              })}
              {contracts.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No contract templates available.</p>}
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Next you&apos;ll fill in your part of each, then send one link to {customerName}.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { onOpenChange(false); setSelected([]) }}>Cancel</Button>
            <Button onClick={handleContinue} disabled={!selected.length || loading}>
              {loading ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : null}
              Continue{selected.length > 1 ? ` with ${selected.length}` : ""} <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DocumentActionSheet
        documents={sheetDocs}
        userId={userId}
        companyName={companyName}
        preset={{ customerId, jobId, recipientEmail: customerEmail ?? "", label: customerName }}
        onClose={() => { setSheetDocs(null); setSelected([]); router.refresh() }}
      />
    </>
  )
}
