"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { parsePartnerLead, extractCity } from "@/lib/partner-lead-parser"
import type { ParsedLeadAppointment } from "@/lib/partner-lead-parser"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, Loader2, MapPin } from "lucide-react"

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-muted-foreground w-32 shrink-0">{label}</span>
      <span className="font-medium text-foreground break-words">{value}</span>
    </div>
  )
}

export default function LeadImportPage() {
  const router = useRouter()
  const [raw, setRaw] = useState("")
  const [parsed, setParsed] = useState<ParsedLeadAppointment | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleParse() {
    if (!raw.trim()) return
    const result = parsePartnerLead(raw.trim())
    setParsed(result)
    setSaved(false)
    setError(null)
  }

  async function handleSave() {
    if (!parsed) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/lead-appointments", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:              parsed.name,
          phone:             parsed.phone,
          address:           parsed.address,
          scheduled_date:    parsed.scheduled_date ?? new Date().toISOString().split("T")[0],
          start_time:        parsed.start_time,
          end_time:          parsed.end_time,
          source:            parsed.source,
          partner_reference: parsed.partner_reference,
          project_summary:   parsed.project_summary,
          notes:             parsed.notes,
          raw_text:          raw.trim(),
          category_code:     parsed.category_code,
        }),
      })
      const data = await res.json() as { appointment_id?: string; customer_id?: string; error?: string }
      if (!res.ok) {
        setError(data.error ?? "Failed to save")
        return
      }
      setSaved(true)
      // Navigate to scheduler for the appointment date
      const date = parsed.scheduled_date ?? new Date().toISOString().split("T")[0]
      setTimeout(() => router.push(`/scheduler?date=${date}`), 1200)
    } catch {
      setError("Network error — please try again")
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setRaw("")
    setParsed(null)
    setSaved(false)
    setError(null)
  }

  const city = extractCity(parsed?.address ?? null)

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Topbar title="Import Lead" subtitle="Paste a raw partner lead message to import it" />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-2xl mx-auto w-full">
        <div className="space-y-5">

          {/* Paste area */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Paste raw lead text</label>
            <Textarea
              placeholder={`Tue May 12, 2026  #5586\n\n02:00 pm -03:00 pm\n\nRosanna\n5626590729\n\n11221 Roxabel St, Santa Fe Springs, CA 90670\n\nRm\n\nLead is the owner looking to remodel...`}
              className="min-h-[180px] font-mono text-xs resize-y"
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setParsed(null); setSaved(false) }}
            />
          </div>

          <div className="flex gap-2">
            <Button onClick={handleParse} disabled={!raw.trim()} className="flex-1">
              Parse Lead
            </Button>
            {parsed && (
              <Button variant="outline" onClick={handleReset}>
                Reset
              </Button>
            )}
          </div>

          {/* Preview */}
          {parsed && !saved && (
            <div className="rounded-xl border bg-card p-4 space-y-4">
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-teal-600 shrink-0" />
                <span className="text-sm font-semibold text-teal-700 dark:text-teal-400">
                  Lead Appointment Preview
                </span>
                {parsed.partner_reference && (
                  <Badge variant="secondary" className="text-xs ml-auto">
                    #{parsed.partner_reference}
                  </Badge>
                )}
              </div>

              <div className="space-y-2">
                <Row label="Name"    value={parsed.name} />
                <Row label="Phone"   value={parsed.phone} />
                <Row label="Address" value={parsed.address} />
                {city && parsed.address && <Row label="City" value={city} />}
                <Row label="Date"    value={parsed.scheduled_date} />
                <Row
                  label="Time"
                  value={
                    parsed.start_time
                      ? `${parsed.start_time}${parsed.end_time ? ` – ${parsed.end_time}` : ""}`
                      : null
                  }
                />
                <Row label="Project"       value={parsed.project_summary} />
                <Row label="Category code" value={parsed.category_code} />
                <Row label="Source"        value={parsed.source} />
              </div>

              {parsed.notes && (
                <div className="pt-1 border-t space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Notes</span>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{parsed.notes}</p>
                </div>
              )}

              {!parsed.name && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Could not extract customer name. Please check the raw text.
                </p>
              )}
              {!parsed.scheduled_date && (
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Could not extract appointment date — today will be used.
                </p>
              )}

              {error && (
                <p className="text-xs text-destructive font-medium">{error}</p>
              )}

              <Button
                onClick={handleSave}
                disabled={saving || !parsed.name}
                className="w-full"
              >
                {saving
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                  : "Save Lead Appointment"
                }
              </Button>
            </div>
          )}

          {/* Success */}
          {saved && (
            <div className="rounded-xl border border-green-200 dark:border-green-800/50 bg-green-50 dark:bg-green-950/20 p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                  Lead saved — redirecting to scheduler…
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
