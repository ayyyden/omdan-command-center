"use client"

import { FieldRow, type FormField } from "@/components/contracts/field-row"

export type SigningField = FormField

interface Props {
  token: string
  contractName: string
  pdfUrl: string | null
  fields: SigningField[]
  values: Record<string, string>
  setValue: (id: string, v: string) => void
  signerName: string
  setSignerName: (v: string) => void
  onOpenSignature: (field: SigningField) => void
  submitting: boolean
  error: string
  onSubmit: () => void
}

// Replaces the old tap-directly-on-the-PDF-image experience with a normal,
// mobile-friendly labeled form — full-size inputs, native date pickers, a
// real textarea for scope-of-work style fields. Only ever receives the
// customer's fields — staff-owned fields (Sales Person Signature, license
// number, etc.) are collected separately in a Prepare step before this
// screen ever loads, see staff-prepare-form.tsx.
export function FillForm({
  token, contractName, pdfUrl, fields, values, setValue, signerName, setSignerName,
  onOpenSignature, submitting, error, onSubmit,
}: Props) {
  const hasName = signerName.trim().length > 0
  const pages = Array.from(new Set(fields.map((f) => f.page_number))).sort((a, b) => a - b)
  const multiPage = pages.length > 1
  const previewUrl = `/api/contracts/preview-pdf/${token}`

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500 font-medium mb-1">Step 2 of 2 · Fill &amp; sign</p>
            <h1 className="text-2xl font-semibold text-slate-900">{contractName}</h1>
          </div>
          {pdfUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2 whitespace-nowrap mt-1"
            >
              View document
            </a>
          )}
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-800 mb-1.5">
              Your Full Legal Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder="Full name, as you'd sign it"
              className="w-full border-2 border-slate-300 rounded-lg px-3.5 py-3 text-base font-medium text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">Used to label your signature on the document.</p>
          </div>

          {pages.map((pageNum) => (
            <div key={pageNum} className="space-y-4 pt-4 border-t border-slate-200 first:border-t-0 first:pt-0">
              {multiPage && (
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Page {pageNum}</p>
              )}
              {fields.filter((f) => f.page_number === pageNum).map((f) => (
                <FieldRow
                  key={f.id}
                  field={f}
                  value={values[f.id] ?? ""}
                  onChange={(v) => setValue(f.id, v)}
                  onOpenSignature={() => onOpenSignature(f)}
                  disabled={!hasName && (f.field_type === "signature" || f.field_type === "initials")}
                />
              ))}
            </div>
          ))}

          {error && (
            <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-3.5 transition-colors text-base mt-2"
          >
            {submitting ? "Submitting…" : "Sign & Submit"}
          </button>
        </div>
      </div>
    </div>
  )
}
