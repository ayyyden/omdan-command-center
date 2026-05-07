"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react"

interface ImportSummary {
  list_id:        string
  summary: {
    row_count:      number
    imported_count: number
    callable_count: number
    no_phone_count: number
    dnc_removed:    number
    dupe_removed:   number
    skipped_count:  number
  }
}

export function ImportForm() {
  const router  = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)

  const [name,     setName]     = useState("")
  const [file,     setFile]     = useState<File | null>(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [result,   setResult]   = useState<ImportSummary | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!file || !name.trim()) return

    setLoading(true)
    setError(null)

    const fd = new FormData()
    fd.append("file", file)
    fd.append("name", name.trim())

    const res = await fetch("/api/propstream/import", { method: "POST", body: fd })
    const data = await res.json()

    setLoading(false)

    if (!res.ok) {
      setError(data.error ?? "Import failed")
      return
    }

    setResult(data as ImportSummary)
  }

  if (result) {
    const { summary } = result
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-green-600">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-semibold">Import complete</span>
        </div>
        <div className="rounded-lg border bg-card p-4 space-y-2 text-sm">
          <Row label="Total rows"      value={summary.row_count} />
          <Row label="Leads imported"  value={summary.imported_count} />
          <Row label="With phone"      value={summary.callable_count} highlight />
          <Row label="No phone"        value={summary.no_phone_count} />
          <Row label="DNC removed"     value={summary.dnc_removed} />
          <Row label="Dupes removed"   value={summary.dupe_removed} />
          <Row label="Skipped (no name)" value={summary.skipped_count} />
        </div>
        <div className="flex gap-2">
          <Button onClick={() => router.push("/propstream-leads")}>
            Go to Leads Dashboard
          </Button>
          <Button variant="outline" onClick={() => { setResult(null); setFile(null); setName("") }}>
            Import Another
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="list-name">List name</Label>
        <Input
          id="list-name"
          placeholder="e.g. Riverside Absentee Owners May 2026"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </div>

      <div className="space-y-1.5">
        <Label>CSV file</Label>
        <div
          className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary/60 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          {file ? (
            <div className="flex items-center justify-center gap-2 text-sm">
              <FileText className="w-4 h-4 text-primary" />
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground">({(file.size / 1024).toFixed(0)} KB)</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 text-muted-foreground text-sm">
              <Upload className="w-6 h-6" />
              <span>Click to select a PropStream CSV export</span>
              <span className="text-xs">Supports standard PropStream exports with Phone 1–5 columns</span>
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      <Button type="submit" disabled={!file || !name.trim() || loading} className="w-full">
        {loading ? "Importing…" : "Import Leads"}
      </Button>
    </form>
  )
}

function Row({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={highlight ? "font-semibold text-green-600" : "font-medium"}>{value.toLocaleString()}</span>
    </div>
  )
}
