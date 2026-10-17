"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { FileSignature, FileText, Paperclip, Send, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { DocumentActionSheet, type DocumentSummary } from "./document-action-sheet"

interface Props {
  documents: DocumentSummary[]
  userId: string
  companyName: string | null
}

// The Documents page: click a document to Sign Now or Send it on its own,
// or tick several to send them together — one link, in the order you tick
// them. Paired "back" documents never appear here; they're attached
// automatically whenever their front page is used (prepare-signing.ts).
export function DocumentsList({ documents, userId, companyName }: Props) {
  const [active, setActive] = useState<DocumentSummary[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])   // in the order ticked

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <FileText className="w-10 h-10 text-muted-foreground/40 mb-4" />
        <p className="text-base font-medium text-muted-foreground">No documents yet</p>
        <p className="text-sm text-muted-foreground/70 mt-1">
          Upload your contract PDFs from Manage Templates below to get started.
        </p>
      </div>
    )
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const pickedDocs = picked.map((id) => documents.find((d) => d.id === id)!).filter(Boolean)

  return (
    <>
      {/* Send-together bar */}
      <div className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 mb-2 text-sm", picked.length ? "bg-primary/5 border-primary/30" : "bg-card")}>
        {picked.length ? (
          <>
            <span className="font-medium">{picked.length} selected</span>
            <span className="text-muted-foreground hidden sm:inline">· sent as one link, in this order</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setPicked([])}><X className="w-3.5 h-3.5" /> Clear</Button>
            <Button size="sm" onClick={() => setActive(pickedDocs)}>
              <Send className="w-3.5 h-3.5" /> {picked.length > 1 ? `Send ${picked.length} together` : "Continue"}
            </Button>
          </>
        ) : (
          <span className="text-muted-foreground">Tick several documents to send them together, or click one to send it alone.</span>
        )}
      </div>

      <div className="rounded-lg border bg-card divide-y">
        {documents.map((doc) => {
          const order = picked.indexOf(doc.id)
          return (
            <div key={doc.id} className={cn("flex items-center gap-1 pr-2", order >= 0 && "bg-primary/[0.04]")}>
              <button
                type="button"
                onClick={() => toggle(doc.id)}
                className="shrink-0 grid place-items-center w-11 h-12"
                aria-label={order >= 0 ? `Remove ${doc.name} from the selection` : `Select ${doc.name}`}
                aria-pressed={order >= 0}
              >
                <span className={cn(
                  "grid place-items-center w-5 h-5 rounded-md border text-[11px] font-semibold tabular-nums",
                  order >= 0 ? "bg-primary text-primary-foreground border-primary" : "border-muted-foreground/40",
                )}>
                  {order >= 0 ? order + 1 : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActive([doc])}
                className="flex-1 min-w-0 flex items-center gap-3 py-3.5 text-left hover:opacity-80"
              >
                {doc.requiresSignature
                  ? <FileSignature className="w-4 h-4 text-blue-600 shrink-0" />
                  : <FileText className="w-4 h-4 text-muted-foreground shrink-0" />}
                <span className="font-medium text-sm flex-1 min-w-0 truncate">{doc.name}</span>
                {doc.hasPairedDoc && (
                  <span title="Includes an auto-attached paired document">
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  </span>
                )}
                <Badge variant={doc.requiresSignature ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {doc.requiresSignature ? "Signature Required" : "Send Only"}
                </Badge>
              </button>
            </div>
          )
        })}
      </div>

      <DocumentActionSheet
        documents={active}
        userId={userId}
        companyName={companyName}
        onClose={() => { setActive(null); setPicked([]) }}
      />
    </>
  )
}
