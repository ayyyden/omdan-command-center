"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseMetaLeadText } from "@/lib/meta-lead-parser"
import type { ParsedMetaLead } from "@/lib/meta-lead-parser"
import { Plus } from "lucide-react"
import { useRouter } from "next/navigation"

export function AddLeadDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState("")
  const [parsed, setParsed] = useState<ParsedMetaLead | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleParse() {
    if (!raw.trim()) return
    setParsed(parseMetaLeadText(raw))
    setError(null)
  }

  function reset() {
    setRaw("")
    setParsed(null)
    setError(null)
  }

  async function handleSave() {
    if (!parsed || !parsed.full_name) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/meta-leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: parsed.full_name,
          email:     parsed.email,
          phone:     parsed.phone,
          city:      parsed.city,
          raw_paste: parsed.raw,
        }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        setError(data.error ?? "Failed to save lead")
        return
      }
      reset()
      setOpen(false)
      router.refresh()
      window.dispatchEvent(new CustomEvent("meta-leads-refresh"))
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" />
          Add Lead
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Meta Lead</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Paste the lead form text from Meta</Label>
            <Textarea
              placeholder={`Hello! I filled out your form...\nEmail: name@example.com\nFull name: Jane Doe\nPhone number: (555) 123-4567\nCity: Coachella`}
              className="min-h-[160px] font-mono text-xs resize-y"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setParsed(null); setError(null) }}
            />
          </div>

          <Button onClick={handleParse} disabled={!raw.trim()} variant="outline" className="w-full">
            Parse
          </Button>

          {parsed && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2.5">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Full name</Label>
                <Input
                  value={parsed.full_name ?? ""}
                  onChange={(e) => setParsed({ ...parsed, full_name: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Email</Label>
                <Input
                  value={parsed.email ?? ""}
                  onChange={(e) => setParsed({ ...parsed, email: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Phone</Label>
                <Input
                  value={parsed.phone ?? ""}
                  onChange={(e) => setParsed({ ...parsed, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">City</Label>
                <Input
                  value={parsed.city ?? ""}
                  onChange={(e) => setParsed({ ...parsed, city: e.target.value })}
                />
              </div>

              {!parsed.full_name && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Full name is required — please fill it in before saving.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          {parsed && (
            <Button onClick={handleSave} disabled={saving || !parsed.full_name}>
              {saving ? "Saving…" : "Save Lead"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
