"use client"

import { useState, useRef, useCallback } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { ImageIcon, Loader2, Trash2, Upload, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

const ALL_CATEGORIES = [
  "materials","labor","subcontractors","permits","dump_fees","equipment",
  "gas","vehicle","tools","office_rent","software","insurance","marketing",
  "meals","travel","utilities","office_supplies","advertising","professional_services","misc",
] as const

const CAT_LABEL = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

type ParsedRow = {
  id:          string
  date:        string
  description: string
  amount:      number
  card_last4:  string
  category:    string
  notes:       string
}

interface Props {
  userId: string
}

export function ExpenseScreenshotDialog({ userId }: Props) {
  const [open,       setOpen]       = useState(false)
  const [step,       setStep]       = useState<"upload" | "review">("upload")
  const [dragging,   setDragging]   = useState(false)
  const [imageFile,  setImageFile]  = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [caption,    setCaption]    = useState("")
  const [parsing,    setParsing]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [rows,       setRows]       = useState<ParsedRow[]>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const router  = useRouter()
  const { toast } = useToast()

  function reset() {
    setStep("upload")
    setImageFile(null)
    setImagePreview(null)
    setCaption("")
    setRows([])
    setParsing(false)
    setSaving(false)
    setDragging(false)
  }

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please upload an image file.", variant: "destructive" })
      return
    }
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [])

  async function parse() {
    if (!imageFile) return
    setParsing(true)
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload  = (e) => {
          const result = e.target?.result as string
          resolve(result.split(",")[1])
        }
        reader.onerror = reject
        reader.readAsDataURL(imageFile)
      })

      const res = await fetch("/api/expenses/parse-screenshot", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          image_base64: base64,
          media_type:   imageFile.type,
          caption:      caption || undefined,
        }),
      })

      if (!res.ok) {
        const err = await res.json() as { error?: string }
        throw new Error(err.error ?? "Parse failed")
      }

      const data = await res.json() as { transactions: Array<{
        date: string; description: string; amount: number
        card_last4: string | null; category: string; notes: string | null
      }> }

      setRows(data.transactions.map((t, i) => ({
        id:          String(i),
        date:        t.date,
        description: t.description,
        amount:      t.amount,
        card_last4:  t.card_last4 ?? "",
        category:    t.category,
        notes:       t.notes ?? "",
      })))
      setStep("review")
    } catch (err: unknown) {
      toast({
        title:       "Parse failed",
        description: err instanceof Error ? err.message : "Could not read the transactions.",
        variant:     "destructive",
      })
    } finally {
      setParsing(false)
    }
  }

  function updateRow(id: string, field: keyof ParsedRow, value: string | number) {
    setRows((prev) => prev.map((r) => r.id === id ? { ...r, [field]: value } : r))
  }

  function deleteRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id))
  }

  async function saveAll() {
    if (!rows.length) return
    setSaving(true)
    const supabase = createClient()

    const toInsert = rows.map((r) => ({
      user_id:      userId,
      expense_type: "business",
      category:     r.category,
      description:  r.description,
      amount:       Number(r.amount),
      date:         r.date,
      notes:        r.notes || null,
      card_last4:   r.card_last4 || null,
      source:       "screenshot_upload",
    }))

    const { error } = await supabase.from("expenses").insert(toInsert)
    setSaving(false)

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" })
      return
    }

    const total = rows.reduce((s, r) => s + Number(r.amount), 0)
    toast({
      title:       `${rows.length} expense${rows.length !== 1 ? "s" : ""} saved`,
      description: `Total: $${total.toFixed(2)}`,
    })
    setOpen(false)
    reset()
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); setOpen(v) }}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ImageIcon className="w-4 h-4 mr-2" />Import Screenshot
        </Button>
      </DialogTrigger>

      <DialogContent className={cn(
        "transition-all duration-200",
        step === "review" ? "sm:max-w-5xl max-h-[90vh] overflow-y-auto" : "sm:max-w-md",
      )}>
        <DialogHeader>
          <DialogTitle>
            {step === "upload" ? "Import Bank Screenshot" : `Review Transactions (${rows.length})`}
          </DialogTitle>
        </DialogHeader>

        {/* ── Step 1: Upload ── */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              className={cn(
                "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30",
                imageFile && "border-green-500 bg-green-50 dark:bg-green-950/20",
              )}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
              />
              {imageFile ? (
                <div className="space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto" />
                  <p className="font-medium text-sm">{imageFile.name}</p>
                  {imagePreview && (
                    <img
                      src={imagePreview}
                      alt="preview"
                      className="max-h-40 mx-auto rounded object-contain border"
                    />
                  )}
                  <p className="text-xs text-muted-foreground">Click to change</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-sm font-medium">Drop screenshot here or click to browse</p>
                  <p className="text-xs text-muted-foreground">JPEG, PNG — bank or credit card statement</p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Note (optional)</label>
              <Input
                placeholder="e.g. Chase card March statement"
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => { setOpen(false); reset() }}>Cancel</Button>
              <Button onClick={parse} disabled={!imageFile || parsing}>
                {parsing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Parsing…</> : "Parse Transactions"}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 2: Review ── */}
        {step === "review" && (
          <div className="space-y-4">
            {rows.length === 0 ? (
              <p className="text-center text-muted-foreground py-8 text-sm">
                No transactions found. Try a different image.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-left px-3 py-2 font-medium">Description</th>
                      <th className="text-left px-3 py-2 font-medium">Amount</th>
                      <th className="text-left px-3 py-2 font-medium">Category</th>
                      <th className="text-left px-3 py-2 font-medium">Card</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/20">
                        <td className="px-3 py-1.5">
                          <Input
                            type="date"
                            value={row.date}
                            className="h-8 w-32 text-xs"
                            onChange={(e) => updateRow(row.id, "date", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            value={row.description}
                            className="h-8 min-w-36 text-xs"
                            onChange={(e) => updateRow(row.id, "description", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={row.amount}
                            className="h-8 w-24 text-xs"
                            onChange={(e) => updateRow(row.id, "amount", parseFloat(e.target.value) || 0)}
                          />
                        </td>
                        <td className="px-3 py-1.5">
                          <Select
                            value={row.category}
                            onValueChange={(v) => updateRow(row.id, "category", v)}
                          >
                            <SelectTrigger className="h-8 w-44 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {ALL_CATEGORIES.map((c) => (
                                <SelectItem key={c} value={c} className="text-xs">{CAT_LABEL(c)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-1.5">
                          <Input
                            value={row.card_last4}
                            placeholder="····"
                            maxLength={4}
                            className="h-8 w-16 text-xs"
                            onChange={(e) => updateRow(row.id, "card_last4", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => deleteRow(row.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rows.length > 0 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Total:{" "}
                  <strong className="text-foreground">
                    ${rows.reduce((s, r) => s + Number(r.amount), 0).toFixed(2)}
                  </strong>
                </span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setStep("upload")}>Back</Button>
              <Button onClick={saveAll} disabled={saving || rows.length === 0}>
                {saving
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                  : `Save ${rows.length} Expense${rows.length !== 1 ? "s" : ""}`
                }
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
