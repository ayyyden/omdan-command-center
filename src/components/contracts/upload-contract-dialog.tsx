"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Upload } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

interface Props {
  userId: string
}

export function UploadContractDialog({ userId }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function reset() {
    setName("")
    setDescription("")
    setFile(null)
    if (fileRef.current) fileRef.current.value = ""
  }

  async function handleSave() {
    if (!file || !name.trim()) return
    setSaving(true)

    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const storagePath = `${userId}/contract_templates/${Date.now()}_${safe}`

    const { error: upErr } = await supabase.storage
      .from("files")
      .upload(storagePath, file, { contentType: "application/pdf" })

    if (upErr) {
      toast({ title: "Upload failed", description: upErr.message, variant: "destructive" })
      setSaving(false)
      return
    }

    const { error: dbErr } = await supabase.from("contract_templates").insert({
      user_id:      userId,
      name:         name.trim(),
      description:  description.trim() || null,
      storage_path: storagePath,
      bucket:       "files",
      file_name:    file.name,
    })

    if (dbErr) {
      await supabase.storage.from("files").remove([storagePath])
      toast({ title: "Save failed", description: dbErr.message, variant: "destructive" })
      setSaving(false)
      return
    }

    toast({ title: "Contract uploaded", description: name.trim() })
    setSaving(false)
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Upload className="w-4 h-4" />
        Upload Contract
      </Button>

      <Dialog open={open} onOpenChange={(o) => { if (!o && !saving) { setOpen(false); reset() } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Contract Template</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="contract-name">Name *</Label>
              <Input
                id="contract-name"
                placeholder="e.g. Residential Roofing Contract"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="contract-desc">Description</Label>
              <Textarea
                id="contract-desc"
                placeholder="Optional description or notes"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>PDF File *</Label>
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileRef.current?.click()}
                    className="gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Choose PDF
                  </Button>
                  {file && (
                    <span className="text-sm text-muted-foreground truncate">{file.name}</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); reset() }} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !file || !name.trim()}>
              {saving ? "Uploading…" : "Save Contract"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
