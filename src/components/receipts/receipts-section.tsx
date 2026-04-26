"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Camera, ImageIcon, X, Loader2, Trash2 } from "lucide-react"
import { compressImage } from "@/lib/compress-image"

interface Receipt {
  id: string
  job_id: string | null
  expense_id: string | null
  file_path: string
  amount: number | null
  note: string | null
  created_at: string
  url: string
}

interface Props {
  userId: string
  jobId?: string
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })
}

export function ReceiptsSection({ userId, jobId }: Props) {
  const supabase = createClient()

  const [receipts, setReceipts]         = useState<Receipt[]>([])
  const [loading, setLoading]           = useState(true)
  const [uploadOpen, setUploadOpen]     = useState(false)
  const [viewReceipt, setViewReceipt]   = useState<Receipt | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Receipt | null>(null)
  const [deleting, setDeleting]         = useState(false)

  // Upload form state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview]           = useState<string | null>(null)
  const [amount, setAmount]             = useState("")
  const [note, setNote]                 = useState("")
  const [selectedJobId, setSelectedJobId] = useState<string>(jobId ?? "none")
  const [jobs, setJobs]                 = useState<{ id: string; title: string }[]>([])
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState<string | null>(null)
  const [compressing, setCompressing]   = useState(false)

  const cameraRef  = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchReceipts = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from("receipts")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (jobId) q = q.eq("job_id", jobId)

    const { data } = await q
    const rows = data ?? []

    if (rows.length === 0) {
      setReceipts([])
      setLoading(false)
      return
    }

    const { data: signed } = await supabase.storage
      .from("files")
      .createSignedUrls(rows.map((r) => r.file_path), 3600)

    const urlMap = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))

    setReceipts(
      rows.map((r) => ({
        id:         r.id,
        job_id:     r.job_id,
        expense_id: r.expense_id,
        file_path:  r.file_path,
        amount:     r.amount !== null ? Number(r.amount) : null,
        note:       r.note,
        created_at: r.created_at,
        url:        urlMap.get(r.file_path) ?? "",
      }))
    )
    setLoading(false)
  }, [userId, jobId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchReceipts() }, [fetchReceipts])

  // Fetch active jobs for the selector (only needed when not scoped to a job)
  useEffect(() => {
    if (jobId || !uploadOpen) return
    supabase
      .from("jobs")
      .select("id, title")
      .eq("user_id", userId)
      .neq("status", "cancelled")
      .order("title")
      .then(({ data }) => setJobs(data ?? []))
  }, [uploadOpen, jobId, userId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Upload helpers ─────────────────────────────────────────────────────────

  async function onFileSelected(file: File | null) {
    if (!file) return
    setSaveError(null)
    setCompressing(true)
    // Show original preview immediately so the UI feels responsive
    setPreview(URL.createObjectURL(file))
    try {
      const compressed = await compressImage(file)
      setSelectedFile(compressed)
      setPreview(URL.createObjectURL(compressed))
    } catch (err) {
      setSaveError((err as Error).message)
      setSelectedFile(null)
      setPreview(null)
    } finally {
      setCompressing(false)
    }
  }

  function resetUpload() {
    setSelectedFile(null)
    setPreview(null)
    setAmount("")
    setNote("")
    setSelectedJobId(jobId ?? "none")
    setSaveError(null)
    setCompressing(false)
  }

  async function save() {
    if (!selectedFile) return
    setSaving(true)
    setSaveError(null)

    const safe = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_")
    const path = `${userId}/receipts/${Date.now()}_${safe}`

    const { error: upErr } = await supabase.storage.from("files").upload(path, selectedFile)
    if (upErr) {
      setSaving(false)
      setSaveError("Upload failed. Check your connection and try again.")
      return
    }

    const { error: dbErr } = await supabase.from("receipts").insert({
      user_id:  userId,
      job_id:   selectedJobId === "none" ? null : selectedJobId,
      file_path: path,
      amount:   amount ? parseFloat(amount) : null,
      note:     note.trim() || null,
    })

    if (dbErr) {
      await supabase.storage.from("files").remove([path])
      setSaving(false)
      setSaveError("Failed to save receipt. Please try again.")
      return
    }

    setSaving(false)
    setUploadOpen(false)
    resetUpload()
    await fetchReceipts()
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  async function confirmDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    await supabase.storage.from("files").remove([deleteTarget.file_path])
    await supabase.from("receipts").delete().eq("id", deleteTarget.id)
    setDeleting(false)
    setDeleteTarget(null)
    setViewReceipt(null)
    await fetchReceipts()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="w-4 h-4" />
              Receipts {!loading && `(${receipts.length})`}
            </CardTitle>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
              <Camera className="w-4 h-4" />
              Add Receipt
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : receipts.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                <Camera className="w-6 h-6 text-muted-foreground/40" />
              </div>
              <p className="text-sm text-muted-foreground">No receipts yet</p>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                <Camera className="w-4 h-4" />
                Add Receipt
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {receipts.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setViewReceipt(r)}
                  className="relative aspect-square rounded-lg overflow-hidden border border-border bg-muted hover:opacity-90 active:scale-95 transition-all"
                >
                  {r.url ? (
                    <img src={r.url} alt="Receipt" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-6 h-6 text-muted-foreground/40" />
                    </div>
                  )}
                  {r.amount !== null && (
                    <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
                      <p className="text-[10px] font-bold text-white tabular-nums leading-none">
                        {fmt(r.amount)}
                      </p>
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Upload dialog ──────────────────────────────────────────────────────── */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(v) => { if (!v && !saving) { setUploadOpen(false); resetUpload() } }}
      >
        <DialogContent className="max-w-sm w-full max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Receipt</DialogTitle>
          </DialogHeader>

          {!selectedFile && !compressing ? (
            <div className="space-y-3 pb-2">
              {/* Hidden inputs */}
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />
              <input
                ref={galleryRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
              />

              {saveError && (
                <p className="text-sm text-destructive px-1">{saveError}</p>
              )}

              {/* Camera button — primary CTA, large tap target */}
              <button
                onClick={() => cameraRef.current?.click()}
                className="flex flex-col items-center gap-4 w-full py-10 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-primary/5 active:bg-primary/10 transition-colors"
              >
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Camera className="w-8 h-8 text-primary" />
                </div>
                <div className="text-center">
                  <p className="font-semibold">Take Photo</p>
                  <p className="text-sm text-muted-foreground">Use your camera</p>
                </div>
              </button>

              {/* Gallery picker */}
              <button
                onClick={() => galleryRef.current?.click()}
                className="flex items-center justify-center gap-2 w-full py-4 rounded-xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 active:bg-muted transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
                Choose from Library
              </button>
            </div>
          ) : compressing ? (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Compressing image…</p>
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              {/* Preview */}
              <div className="relative">
                <img
                  src={preview ?? ""}
                  alt="Preview"
                  className="w-full max-h-52 object-contain rounded-xl border border-border bg-muted"
                />
                <button
                  onClick={resetUpload}
                  className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <Label>
                  Amount{" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    className="pl-7 text-base"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
              </div>

              {/* Note */}
              <div className="space-y-1.5">
                <Label>
                  Note{" "}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  className="text-base"
                  placeholder="e.g. Home Depot – lumber"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {/* Job selector — only when not already scoped to a job */}
              {!jobId && (
                <div className="space-y-1.5">
                  <Label>
                    Attach to Job{" "}
                    <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                  </Label>
                  <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                    <SelectTrigger className="text-base">
                      <SelectValue placeholder="General / No Job" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">General / No Job</SelectItem>
                      {jobs.map((j) => (
                        <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {saveError && (
                <p className="text-sm text-destructive">{saveError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <Button
                  variant="outline"
                  className="flex-1 h-12 text-base"
                  disabled={saving}
                  onClick={() => { setUploadOpen(false); resetUpload() }}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1 h-12 text-base gap-2"
                  disabled={saving || compressing}
                  onClick={save}
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Receipt
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Lightbox ───────────────────────────────────────────────────────────── */}
      {viewReceipt && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          {/* Header bar */}
          <div
            className="flex items-start justify-between px-4 pt-safe-top pb-3 pt-3 bg-black/80 shrink-0"
            style={{ paddingTop: "max(12px, env(safe-area-inset-top))" }}
          >
            <div className="min-w-0">
              {viewReceipt.amount !== null && (
                <p className="text-xl font-bold text-white tabular-nums">
                  {fmt(viewReceipt.amount)}
                </p>
              )}
              {viewReceipt.note && (
                <p className="text-sm text-white/70 truncate mt-0.5">{viewReceipt.note}</p>
              )}
              <p className="text-xs text-white/40 mt-0.5">{fmtDate(viewReceipt.created_at)}</p>
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              <button
                onClick={() => { setDeleteTarget(viewReceipt) }}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                aria-label="Delete receipt"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewReceipt(null)}
                className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Image — fills remaining space, tap backdrop to close */}
          <div
            className="flex-1 flex items-center justify-center p-4 min-h-0"
            onClick={() => setViewReceipt(null)}
          >
            <img
              src={viewReceipt.url}
              alt="Receipt"
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────────── */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v && !deleting) setDeleteTarget(null) }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete receipt?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This receipt photo will be permanently deleted.
          </p>
          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1 gap-1.5"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
