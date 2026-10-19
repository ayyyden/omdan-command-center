"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { StaffPrepareForm } from "./staff-prepare-form"
import type { FormField } from "./field-row"
import { sortForFilling } from "@/lib/contracts/fill-order"

// Sent contracts list → "Edit my part": change what you filled in on a
// contract the customer hasn't signed yet. Same link, nothing re-sent.
export function EditSentDialog({ sentContractId, onClose }: { sentContractId: string | null; onClose: (saved: boolean) => void }) {
  const { toast } = useToast()
  const [data, setData] = useState<{ name: string; fields: FormField[]; values: Record<string, string> } | null>(null)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!sentContractId) return
    setData(null); setError("")
    fetch(`/api/contracts/staff-values?id=${sentContractId}`)
      .then(async (r) => {
        const j = await r.json()
        if (!r.ok) throw new Error(j.error ?? "Couldn't load the contract")
        if (j.status === "signed") throw new Error("The customer already signed this contract — it can't be changed.")
        setData({ name: j.name, fields: sortForFilling(j.fields), values: j.values })
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [sentContractId])

  async function save(fieldValues: Record<string, string>) {
    setSaving(true)
    const res = await fetch("/api/contracts/staff-values", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sentContractId, staffFieldValues: fieldValues }),
    })
    setSaving(false)
    const j = await res.json().catch(() => ({}))
    if (!res.ok) {
      toast({ title: "Couldn't save", description: j.error ?? "Unknown error", variant: "destructive" })
      return
    }
    toast({ title: "Changes saved", description: "The customer's link now shows the updated contract — no need to resend." })
    onClose(true)
  }

  return (
    <Dialog open={!!sentContractId} onOpenChange={(o) => { if (!o) onClose(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit your part{data ? ` · ${data.name}` : ""}</DialogTitle>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!error && !data && (
          <div className="flex items-center justify-center py-8 text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
        )}
        {data && data.fields.length === 0 && (
          <p className="text-sm text-muted-foreground">This document has nothing for you to fill in.</p>
        )}
        {data && data.fields.length > 0 && (
          <div className={saving ? "pointer-events-none opacity-60" : ""}>
            <StaffPrepareForm
              documentName={data.name}
              fields={data.fields}
              initialValues={data.values}
              onContinue={({ fieldValues }) => save(fieldValues)}
              onBack={() => onClose(false)}
              backLabel="Cancel"
              continueLabel={saving ? "Saving…" : "Save changes"}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
