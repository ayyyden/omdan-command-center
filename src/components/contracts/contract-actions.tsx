"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Eye, ToggleLeft, ToggleRight, Trash2, Loader2 } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { FieldEditorDialog } from "./field-editor-dialog"

interface ContractTemplate {
  id: string
  name: string
  storage_path: string
  bucket: string
  is_active: boolean
}

interface Props {
  contract: ContractTemplate
}

export function ContractActions({ contract }: Props) {
  const { toast } = useToast()
  const router = useRouter()
  const supabase = createClient()

  const [loadingPreview, setLoadingPreview] = useState(false)
  const [toggling, setToggling] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handlePreview() {
    setLoadingPreview(true)
    const { data, error } = await supabase.storage
      .from(contract.bucket)
      .createSignedUrl(contract.storage_path, 3600)
    setLoadingPreview(false)
    if (error || !data?.signedUrl) {
      toast({ title: "Preview failed", description: error?.message, variant: "destructive" })
      return
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer")
  }

  async function handleToggle() {
    setToggling(true)
    const { error } = await supabase
      .from("contract_templates")
      .update({ is_active: !contract.is_active })
      .eq("id", contract.id)
    setToggling(false)
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: contract.is_active ? "Contract deactivated" : "Contract activated" })
    router.refresh()
  }

  async function handleDelete() {
    setDeleting(true)
    await supabase.storage.from(contract.bucket).remove([contract.storage_path])
    const { error } = await supabase
      .from("contract_templates")
      .delete()
      .eq("id", contract.id)
    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      setConfirmDelete(false)
      return
    }
    toast({ title: "Contract deleted", description: contract.name })
    setConfirmDelete(false)
    router.refresh()
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <FieldEditorDialog
          contractTemplateId={contract.id}
          contractName={contract.name}
          storagePath={contract.storage_path}
          bucket={contract.bucket}
        />

        <Button
          size="sm"
          variant="ghost"
          onClick={handlePreview}
          disabled={loadingPreview}
          className="gap-1.5 h-8"
          title="Preview PDF"
        >
          {loadingPreview
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Eye className="w-3.5 h-3.5" />
          }
          Preview
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleToggle}
          disabled={toggling}
          className="gap-1.5 h-8"
          title={contract.is_active ? "Deactivate" : "Activate"}
        >
          {toggling
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : contract.is_active
              ? <ToggleRight className="w-3.5 h-3.5 text-success" />
              : <ToggleLeft className="w-3.5 h-3.5 text-muted-foreground" />
          }
          {contract.is_active ? "Deactivate" : "Activate"}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={() => setConfirmDelete(true)}
          className="gap-1.5 h-8 text-destructive hover:text-destructive"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
      </div>

      <Dialog open={confirmDelete} onOpenChange={(o) => { if (!o && !deleting) setConfirmDelete(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Contract?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{contract.name}</span> will be permanently
            deleted. Previously sent copies are not affected.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
