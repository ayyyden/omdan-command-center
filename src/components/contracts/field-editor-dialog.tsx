"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Settings2, Loader2 } from "lucide-react"
import { FieldEditor } from "./field-editor"

interface Props {
  contractTemplateId: string
  contractName: string
  storagePath: string
  bucket: string
}

export function FieldEditorDialog({
  contractTemplateId,
  contractName,
  storagePath,
  bucket,
}: Props) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleOpen() {
    setLoading(true)
    const { data } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 7200)
    setPdfUrl(data?.signedUrl ?? null)
    setLoading(false)
    setOpen(true)
  }

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleOpen}
        disabled={loading}
        className="gap-1.5 h-8"
        title="Edit Fields"
      >
        {loading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Settings2 className="w-3.5 h-3.5" />
        }
        Edit Fields
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[95vw] w-[1100px] max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle>Field Editor — {contractName}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-hidden px-5 pb-5 pt-4">
            {open && (
              <FieldEditor
                contractTemplateId={contractTemplateId}
                contractName={contractName}
                pdfUrl={pdfUrl}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
