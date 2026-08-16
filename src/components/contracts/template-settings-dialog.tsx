"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Settings } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface OtherTemplate {
  id: string
  name: string
}

interface Props {
  templateId: string
  requiresSignature: boolean
  attachedToTemplateId: string | null
  otherTemplates: OtherTemplate[]
}

// Lets staff confirm/adjust the auto-classification a document got when it
// was onboarded — "Requires signature" and "pair as back page of another
// document" — without needing a new upload.
export function TemplateSettingsDialog({ templateId, requiresSignature, attachedToTemplateId, otherTemplates }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [requiresSig, setRequiresSig] = useState(requiresSignature)
  const [pairWith, setPairWith] = useState(attachedToTemplateId ?? "none")
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const { error } = await supabase
      .from("contract_templates")
      .update({
        requires_signature: requiresSig,
        attached_to_template_id: pairWith === "none" ? null : pairWith,
      })
      .eq("id", templateId)
    setSaving(false)
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Document settings updated" })
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="gap-1.5 h-8" title="Document settings">
        <Settings className="w-3.5 h-3.5" />
        Settings
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!saving) setOpen(o) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Document Settings</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3">
              <input
                type="checkbox"
                checked={requiresSig}
                onChange={(e) => setRequiresSig(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
              />
              <span>
                <span className="block text-sm font-medium">Requires signature</span>
                <span className="block text-xs text-muted-foreground mt-0.5">
                  Off = send-only (no fill form, no signing step — e.g. a license or warranty card).
                </span>
              </span>
            </label>

            <div className="space-y-1.5">
              <Label>Pair as back page of…</Label>
              <Select value={pairWith} onValueChange={setPairWith}>
                <SelectTrigger>
                  <SelectValue placeholder="Not paired" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not paired — show on its own</SelectItem>
                  {otherTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Paired documents are hidden from the Documents list and always sent/signed together with their parent.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
