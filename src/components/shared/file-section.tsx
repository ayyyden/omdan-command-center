"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Paperclip, Upload, Download, Trash2, FileText, File } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { compressImage } from "@/lib/compress-image"

// ── Constants ─────────────────────────────────────────────────────────────────

type EntityType = "jobs" | "customers" | "estimates"

type FileCategory =
  | "photos" | "progress_photos" | "receipts" | "payment_checks"
  | "contracts" | "signed_contracts" | "permits" | "pdfs" | "other"

const CATEGORY_LABELS: Record<FileCategory, string> = {
  photos:           "Photos",
  progress_photos:  "Progress Photos",
  receipts:         "Receipts",
  payment_checks:   "Payment Checks",
  contracts:        "Contracts",
  signed_contracts: "Signed Contracts",
  permits:          "Permits",
  pdfs:             "PDFs",
  other:            "Other",
}

const CATEGORIES = Object.keys(CATEGORY_LABELS) as FileCategory[]

const CATEGORY_COLOR: Record<FileCategory, string> = {
  photos:           "bg-blue-100 text-blue-700",
  progress_photos:  "bg-cyan-100 text-cyan-700",
  receipts:         "bg-orange-100 text-orange-700",
  payment_checks:   "bg-green-100 text-green-700",
  contracts:        "bg-purple-100 text-purple-700",
  signed_contracts: "bg-violet-100 text-violet-700",
  permits:          "bg-yellow-100 text-yellow-700",
  pdfs:             "bg-rose-100 text-rose-700",
  other:            "bg-gray-100 text-gray-500",
}

function defaultCategory(mimeType: string): FileCategory {
  if (mimeType.startsWith("image/")) return "photos"
  if (mimeType === "application/pdf") return "pdfs"
  return "other"
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinkedEntity {
  entityType: EntityType
  entityId: string
  label: string
}

interface FileRecord {
  id: string
  bucket: string
  storagePath: string
  storageUrl: string
  fileName: string
  category: FileCategory
  sizeBytes: number
  mimeType: string | null
  createdAt: string
  isLinked: boolean
  linkedLabel?: string
}

interface Props {
  entityType: EntityType
  entityId: string
  userId: string
  linkedEntities?: LinkedEntity[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isImage(fileName: string, mimeType: string | null): boolean {
  return (mimeType?.startsWith("image/") ?? false) ||
    /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName)
}

function formatBytes(bytes: number): string {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function fmtDate(iso: string): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function FileSection({
  entityType,
  entityId,
  userId,
  linkedEntities = [],
}: Props) {
  const { toast } = useToast()
  const supabase = createClient()

  const [files, setFiles] = useState<FileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [filterCat, setFilterCat] = useState<FileCategory | "all">("all")

  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [uploadCategory, setUploadCategory] = useState<FileCategory>("other")
  const [uploading, setUploading] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<FileRecord | null>(null)
  const [deleting, setDeleting] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stable key for linked entities so useEffect isn't re-triggered by array identity
  const linkedKey = linkedEntities
    .map((e) => `${e.entityType}:${e.entityId}`)
    .join("|")

  // ── Fetch ───────────────────────────────────────────────────────────────────

  async function fetchFiles() {
    setLoading(true)

    // Own entity files
    const { data: ownRows } = await supabase
      .from("file_attachments")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })

    // Linked entity files
    let linkedRows: Record<string, unknown>[] = []
    if (linkedEntities.length > 0) {
      const orFilter = linkedEntities
        .map((e) => `and(entity_type.eq.${e.entityType},entity_id.eq.${e.entityId})`)
        .join(",")
      const { data } = await supabase
        .from("file_attachments")
        .select("*")
        .or(orFilter)
        .order("created_at", { ascending: false })
      linkedRows = (data ?? []) as Record<string, unknown>[]
    }

    // Tag rows
    const tagged = [
      ...(ownRows ?? []).map((r) => ({ ...r, _linked: false, _label: "" })),
      ...linkedRows.map((r) => ({
        ...r,
        _linked: true,
        _label:
          linkedEntities.find(
            (e) =>
              e.entityType === (r.entity_type as string) &&
              e.entityId === (r.entity_id as string)
          )?.label ?? "",
      })),
    ]

    if (tagged.length === 0) {
      setFiles([])
      setLoading(false)
      return
    }

    // Generate signed URLs for the private 'files' bucket
    const privateRows = tagged.filter((r) => r.bucket === "files")
    const urlMap = new Map<string, string>()

    if (privateRows.length > 0) {
      const { data: signedData } = await supabase.storage
        .from("files")
        .createSignedUrls(
          privateRows.map((r) => r.storage_path as string),
          3600
        )
      for (const s of signedData ?? []) {
        if (s.path && s.signedUrl) urlMap.set(s.path, s.signedUrl)
      }
    }

    // Public URLs for the 'documents' bucket
    for (const r of tagged.filter((row) => row.bucket === "documents")) {
      const { data } = supabase.storage
        .from("documents")
        .getPublicUrl(r.storage_path as string)
      urlMap.set(r.storage_path as string, data.publicUrl)
    }

    setFiles(
      tagged.map((r) => ({
        id: r.id as string,
        bucket: r.bucket as string,
        storagePath: r.storage_path as string,
        storageUrl: urlMap.get(r.storage_path as string) ?? "",
        fileName: r.file_name as string,
        category: (r.category as FileCategory) ?? "other",
        sizeBytes: (r.size_bytes as number) ?? 0,
        mimeType: (r.mime_type as string) ?? null,
        createdAt: r.created_at as string,
        isLinked: r._linked as boolean,
        linkedLabel: r._label as string,
      }))
    )
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchFiles() }, [entityType, entityId, userId, linkedKey])

  // ── Upload ──────────────────────────────────────────────────────────────────

  async function onFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const sel = Array.from(e.target.files ?? [])
    if (!sel.length) return
    if (fileInputRef.current) fileInputRef.current.value = ""

    const processed: File[] = []
    for (const file of sel) {
      try {
        processed.push(await compressImage(file))
      } catch (err) {
        toast({
          title: `Cannot use ${file.name}`,
          description: (err as Error).message,
          variant: "destructive",
        })
      }
    }

    if (!processed.length) return
    setUploadCategory(defaultCategory(processed[0].type))
    setPendingFiles(processed)
  }

  async function confirmUpload() {
    setUploading(true)
    const folder = `${userId}/${entityType}/${entityId}`
    let ok = 0

    for (const file of pendingFiles) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")
      const path = `${folder}/${Date.now()}_${safe}`

      const { error: upErr } = await supabase.storage.from("files").upload(path, file)
      if (upErr) {
        toast({ title: `Upload failed: ${file.name}`, description: upErr.message, variant: "destructive" })
        continue
      }

      const { error: dbErr } = await supabase.from("file_attachments").insert({
        user_id: userId,
        bucket: "files",
        storage_path: path,
        file_name: file.name,
        category: uploadCategory,
        entity_type: entityType,
        entity_id: entityId,
        size_bytes: file.size,
        mime_type: file.type || null,
      })

      if (dbErr) {
        await supabase.storage.from("files").remove([path])
        toast({ title: `Save failed: ${file.name}`, description: dbErr.message, variant: "destructive" })
        continue
      }

      ok++
    }

    setUploading(false)
    setPendingFiles([])
    if (ok > 0) {
      toast({ title: `Uploaded ${ok} file${ok !== 1 ? "s" : ""}` })
      await fetchFiles()
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)

    // Only remove from storage for the private 'files' bucket
    if (deleteTarget.bucket === "files") {
      await supabase.storage.from("files").remove([deleteTarget.storagePath])
    }

    const { error } = await supabase
      .from("file_attachments")
      .delete()
      .eq("id", deleteTarget.id)

    setDeleting(false)
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "File removed" })
    setDeleteTarget(null)
    await fetchFiles()
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const presentCats = [...new Set(files.map((f) => f.category))]
  const displayed = filterCat === "all" ? files : files.filter((f) => f.category === filterCat)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="w-4 h-4" />
              Files {!loading && `(${files.length})`}
            </CardTitle>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
                className="hidden"
                onChange={onFilesSelected}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                className="gap-1.5"
              >
                <Upload className="w-3.5 h-3.5" />
                Upload
              </Button>
            </div>
          </div>

          {/* Category filter */}
          {!loading && presentCats.length > 1 && (
            <div className="flex flex-wrap gap-1 pt-2">
              <button
                onClick={() => setFilterCat("all")}
                className={[
                  "text-xs px-2 py-0.5 rounded-full border transition-colors",
                  filterCat === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                ].join(" ")}
              >
                All ({files.length})
              </button>
              {presentCats.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setFilterCat(cat === filterCat ? "all" : cat)}
                  className={[
                    "text-xs px-2 py-0.5 rounded-full border transition-colors",
                    filterCat === cat
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:bg-muted/60",
                  ].join(" ")}
                >
                  {CATEGORY_LABELS[cat]} ({files.filter((f) => f.category === cat).length})
                </button>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : displayed.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {files.length === 0
                ? "No files attached yet."
                : "No files in this category."}
            </p>
          ) : (
            <div className="space-y-1">
              {displayed.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 group"
                >
                  {/* Thumbnail or icon */}
                  {isImage(file.fileName, file.mimeType) && file.storageUrl ? (
                    <a
                      href={file.storageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0"
                    >
                      <img
                        src={file.storageUrl}
                        alt={file.fileName}
                        className="w-10 h-10 rounded object-cover border border-border"
                      />
                    </a>
                  ) : (
                    <div className="w-10 h-10 rounded border border-border bg-muted flex items-center justify-center shrink-0">
                      {file.mimeType === "application/pdf" ||
                      /\.pdf$/i.test(file.fileName) ? (
                        <FileText className="w-5 h-5 text-muted-foreground" />
                      ) : (
                        <File className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                  )}

                  {/* Name + badges */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <p className="text-sm font-medium truncate min-w-0">
                        {file.fileName}
                      </p>
                      <span
                        className={[
                          "text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0",
                          CATEGORY_COLOR[file.category],
                        ].join(" ")}
                      >
                        {CATEGORY_LABELS[file.category]}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[
                        formatBytes(file.sizeBytes),
                        file.createdAt ? fmtDate(file.createdAt) : null,
                        file.isLinked && file.linkedLabel
                          ? `from ${file.linkedLabel}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {file.storageUrl && (
                      <a
                        href={file.storageUrl}
                        download={file.fileName}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button size="icon" variant="ghost" className="h-7 w-7">
                          <Download className="w-3.5 h-3.5" />
                        </Button>
                      </a>
                    )}
                    {!file.isLinked && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(file)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload category dialog */}
      <Dialog
        open={pendingFiles.length > 0}
        onOpenChange={(open) => {
          if (!open && !uploading) setPendingFiles([])
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Upload {pendingFiles.length} file{pendingFiles.length !== 1 ? "s" : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {pendingFiles.map((f) => (
                <p key={f.name} className="text-sm text-muted-foreground truncate">
                  {f.name}
                </p>
              ))}
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Category</p>
              <Select
                value={uploadCategory}
                onValueChange={(v) => setUploadCategory(v as FileCategory)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {CATEGORY_LABELS[cat]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingFiles([])}
              disabled={uploading}
            >
              Cancel
            </Button>
            <Button onClick={confirmUpload} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              {deleteTarget?.fileName}
            </span>{" "}
            will be permanently deleted. This cannot be undone.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
