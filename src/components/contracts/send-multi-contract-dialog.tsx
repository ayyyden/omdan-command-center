"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { FileText, Loader2, Send } from "lucide-react"

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

export function SendMultiContractDialog({
  contracts,
  customerId,
  jobId,
  customerEmail,
  customerName,
  companyName,
  open,
  onOpenChange,
}: Props) {
  const { toast } = useToast()
  const router = useRouter()

  // Ordered array — index = selection order
  const [selected, setSelected] = useState<string[]>([])
  const [recipientEmail, setRecipientEmail] = useState(customerEmail ?? "")
  const [subject, setSubject] = useState(
    `Contracts from ${companyName ?? "Us"} — Please Sign`
  )
  const [body, setBody] = useState(
    `Hi ${customerName},\n\nPlease review and sign the attached contract(s) at your earliest convenience.\n\nThank you!`
  )
  const [sending, setSending] = useState(false)

  function toggleContract(id: string) {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id]
    })
  }

  function reset() {
    setSelected([])
    setRecipientEmail(customerEmail ?? "")
    setSubject(`Contracts from ${companyName ?? "Us"} — Please Sign`)
    setBody(
      `Hi ${customerName},\n\nPlease review and sign the attached contract(s) at your earliest convenience.\n\nThank you!`
    )
  }

  async function handleSend() {
    if (!selected.length) { toast({ title: "Select at least one contract", variant: "destructive" }); return }
    if (!recipientEmail) { toast({ title: "Recipient email required", variant: "destructive" }); return }

    setSending(true)
    try {
      const res = await fetch("/api/contracts/send-bundle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contractIds:    selected,
          customerId,
          jobId,
          recipientEmail,
          subject,
          body,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toast({ title: "Send failed", description: (d as any).error ?? "Unknown error", variant: "destructive" })
        return
      }
      const { count } = await res.json()
      toast({
        title: "Contracts sent",
        description: `${count} contract${count !== 1 ? "s" : ""} sent to ${recipientEmail}`,
      })
      onOpenChange(false)
      reset()
      router.refresh()
    } catch {
      toast({ title: "Send failed", description: "Network error", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!sending) { onOpenChange(o); if (!o) reset() } }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Contracts</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Contract selection */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Select Contracts — tap to set signing order
            </label>
            <div className="rounded-lg border divide-y">
              {contracts.map((c) => {
                const pos = selected.indexOf(c.id)
                const isSelected = pos !== -1
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                    onClick={() => toggleContract(c.id)}
                  >
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 text-[10px] font-bold transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected ? pos + 1 : null}
                    </div>
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm">{c.name}</span>
                  </button>
                )
              })}
              {contracts.length === 0 && (
                <p className="px-3 py-3 text-sm text-muted-foreground">No contract templates available.</p>
              )}
            </div>
            {selected.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {selected.length} contract{selected.length !== 1 ? "s" : ""} selected — client signs them in the order shown.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">To</label>
            <Input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="customer@example.com"
            />
            {!customerEmail && (
              <p className="text-xs text-warning">No email on file — enter one above.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Subject</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Message</label>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[100px] text-sm"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            The customer receives one secure link. Contracts are presented and signed one at a time in the order above.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => { onOpenChange(false); reset() }} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={handleSend}
            disabled={sending || !selected.length || !recipientEmail || !subject || !body}
          >
            {sending
              ? <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
              : <><Send className="w-4 h-4 mr-1.5" />Send{selected.length > 1 ? ` ${selected.length} Contracts` : " Contract"}</>}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
