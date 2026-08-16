"use client"

import type { FieldType } from "@/components/contracts/field-editor"

export interface SigningField {
  id: string
  page_number: number
  field_type: FieldType
  label: string
  required: boolean
}

interface Props {
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

// Replaces the old tap-directly-on-the-tiny-PDF-blank experience with a
// normal, mobile-friendly labeled form — full-size inputs, native date
// pickers, a real textarea for scope-of-work style fields. Values get
// stamped onto the original PDF server-side afterward (unchanged pdf-lib
// pipeline in /api/contracts/sign/[token]) — this component only changes
// how the values are captured.
export function FillForm({
  contractName, pdfUrl, fields, values, setValue, signerName, setSignerName,
  onOpenSignature, submitting, error, onSubmit,
}: Props) {
  const hasName = signerName.trim().length > 0
  const pages = Array.from(new Set(fields.map((f) => f.page_number))).sort((a, b) => a - b)
  const multiPage = pages.length > 1

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
              href={pdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700 underline underline-offset-2 whitespace-nowrap mt-1"
            >
              View original document
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

function FieldRow({
  field, value, onChange, onOpenSignature, disabled,
}: {
  field: SigningField
  value: string
  onChange: (v: string) => void
  onOpenSignature: () => void
  disabled: boolean
}) {
  const label = (
    <label className="block text-sm font-semibold text-slate-800 mb-1.5">
      {field.label}
      {field.required && <span className="text-red-500"> *</span>}
    </label>
  )

  const inputClass =
    "w-full border-2 border-slate-300 rounded-lg px-3.5 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"

  switch (field.field_type) {
    case "text":
      return (
        <div>
          {label}
          <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
        </div>
      )

    case "date":
      return (
        <div>
          {label}
          <input type="date" value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} style={{ fontSize: "16px" }} />
        </div>
      )

    case "multiline":
    case "rich_text":
      return (
        <div>
          {label}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={4}
            className={`${inputClass} resize-y`}
          />
        </div>
      )

    case "checkbox":
      return (
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
            className="h-5 w-5 shrink-0 accent-blue-600"
          />
          <span className="text-sm font-medium text-slate-800">{field.label}</span>
        </label>
      )

    case "yes_no":
      return (
        <div>
          {label}
          <div className="flex gap-2">
            {["Yes", "No"].map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold border-2 transition-colors ${
                  value === opt
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-slate-300 text-slate-600 hover:border-slate-400"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )

    case "signature":
    case "initials": {
      const isInitials = field.field_type === "initials"
      return (
        <div>
          {label}
          <button
            type="button"
            onClick={onOpenSignature}
            disabled={disabled}
            className="w-full rounded-lg border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors p-4 flex items-center justify-center"
            style={{ minHeight: isInitials ? 72 : 96 }}
          >
            {value ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value} alt={field.label} className="max-h-20 object-contain" />
            ) : (
              <span className="text-sm font-medium text-slate-500">
                {disabled ? "Enter your name above first" : isInitials ? "Tap to add initials" : "Tap to sign"}
              </span>
            )}
          </button>
          {value && (
            <button type="button" onClick={onOpenSignature} className="text-xs font-medium text-blue-600 hover:text-blue-700 mt-1.5">
              Redo {isInitials ? "initials" : "signature"}
            </button>
          )}
        </div>
      )
    }

    default:
      return null
  }
}
