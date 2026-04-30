"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SendMultiContractDialog } from "@/components/contracts/send-multi-contract-dialog"
import { Send, FileSignature } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface ContractTemplate {
  id: string
  name: string
}

interface SentContract {
  id: string
  contract_template: { name: string } | null
  recipient_email: string
  status: string
  sent_at: string
  signed_at: string | null
  signer_name: string | null
}

interface Props {
  contracts: ContractTemplate[]
  sentContracts: SentContract[]
  customerId: string
  jobId: string
  customerEmail: string | null
  customerName: string
  companyName: string | null
}

export function JobContractsSection({
  contracts,
  sentContracts,
  customerId,
  jobId,
  customerEmail,
  customerName,
  companyName,
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setDialogOpen(true)}
        >
          <Send className="w-3.5 h-3.5" />
          Send Contracts
        </Button>
      </div>

      {sentContracts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contracts sent yet.</p>
      ) : (
        <div className="divide-y divide-border/50">
          {sentContracts.map((sc) => (
            <div key={sc.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
              <FileSignature className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium text-sm flex-1 min-w-0 truncate">
                {sc.contract_template?.name ?? "Contract"}
              </span>
              {sc.signed_at ? (
                <Badge variant="default" className="bg-success/15 text-success border-success/20 text-[10px] font-semibold shrink-0">
                  Signed
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] font-semibold shrink-0">
                  Awaiting
                </Badge>
              )}
              <span className="text-xs text-muted-foreground shrink-0">
                {sc.signed_at
                  ? `Signed ${formatDate(sc.signed_at.split("T")[0])}`
                  : `Sent ${formatDate(sc.sent_at.split("T")[0])}`}
              </span>
              {sc.signer_name && (
                <span className="text-xs text-muted-foreground shrink-0">by {sc.signer_name}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <SendMultiContractDialog
        contracts={contracts}
        customerId={customerId}
        jobId={jobId}
        customerEmail={customerEmail}
        customerName={customerName}
        companyName={companyName}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </>
  )
}
