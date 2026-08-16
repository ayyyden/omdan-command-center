"use client"

import type { FieldType } from "@/components/contracts/field-editor"

export interface FormField {
  id: string
  page_number: number
  field_type: FieldType
  label: string
  required: boolean
}

// Shared labeled-input renderer for both the customer FillForm
// (sign-contract/[token]/fill-form.tsx) and the staff Prepare step
// (staff-prepare-form.tsx) — one normal, mobile-friendly form control per
// field type, values get stamped onto the original PDF server-side
// afterward (unchanged pdf-lib pipeline in /api/contracts/sign/[token]).
export function FieldRow({
  field, value, onChange, onOpenSignature, disabled,
}: {
  field: FormField
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
