"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { FileSignature, FileText, Paperclip } from "lucide-react"
import { DocumentActionSheet, type DocumentSummary } from "./document-action-sheet"

interface Props {
  documents: DocumentSummary[]
  userId: string
  companyName: string | null
}

// The redesigned Documents page: one flat list, click a document to Sign
// Now or Send by Email. Paired "back" documents never appear here — they're
// filtered out server-side and auto-attached whenever their front page is
// used (see documents-list's server caller and prepare-signing.ts).
export function DocumentsList({ documents, userId, companyName }: Props) {
  const [active, setActive] = useState<DocumentSummary | null>(null)

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

  return (
    <>
      <div className="rounded-lg border bg-card divide-y">
        {documents.map((doc) => (
          <button
            key={doc.id}
            type="button"
            onClick={() => setActive(doc)}
            className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-muted/40 transition-colors"
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
            <Badge
              variant={doc.requiresSignature ? "default" : "secondary"}
              className="shrink-0 text-[10px]"
            >
              {doc.requiresSignature ? "Signature Required" : "Send Only"}
            </Badge>
          </button>
        ))}
      </div>

      <DocumentActionSheet
        document={active}
        userId={userId}
        companyName={companyName}
        onClose={() => setActive(null)}
      />
    </>
  )
}
