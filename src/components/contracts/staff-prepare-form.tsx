"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FieldList, type FormField } from "@/components/contracts/field-row"
import { firstMissingRequired } from "@/lib/contracts/choice-groups"
import { SignatureModal } from "@/components/contracts/signature-modal"

interface Props {
  documentName: string
  fields: FormField[]
  /** Values typed earlier (when coming back to edit) */
  initialValues?: Record<string, string>
  onContinue: (result: { fieldValues: Record<string, string> }) => void
}

// Collects the blanks that belong to staff, not the customer — Sales
// Person Signature, license/registration numbers, an entirely-staff page
// like the Continuation/Addendum — before the customer ever sees the
// consent or fill screens. No ESIGN consent screen here: this is an
// employee acting for the company inside their own logged-in session, not
// an external party being asked for e-signature consent.
export function StaffPrepareForm({ documentName, fields, initialValues, onContinue }: Props) {
  const [values, setValues]         = useState<Record<string, string>>(initialValues ?? {})
  const [signerName, setSignerName] = useState("")
  const [modalField, setModalField] = useState<FormField | null>(null)
  const [error, setError]           = useState("")

  const hasSignatureField = fields.some((f) => f.field_type === "signature" || f.field_type === "initials")

  function setValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  function handleContinue() {
    const missing = firstMissingRequired(fields, values)
    if (missing) {
      setError(`"${missing}" is required.`)
      return
    }
    if (hasSignatureField && !signerName.trim()) {
      setError("Enter your name before signing.")
      return
    }
    setError("")
    onContinue({ fieldValues: values })
  }

  return (
    <div className="space-y-4">
      {modalField && (
        <SignatureModal
          type={modalField.field_type as "signature" | "initials"}
          signerName={signerName}
          onDone={(dataUrl) => { setValue(modalField.id, dataUrl); setModalField(null) }}
          onCancel={() => setModalField(null)}
        />
      )}

      <p className="text-sm text-muted-foreground">
        Fill in your part of <span className="font-medium text-foreground">{documentName}</span> — the
        customer won&apos;t see or need to fill these.
      </p>

      {hasSignatureField && (
        <div className="space-y-1.5">
          <label className="text-sm font-semibold text-foreground">Your Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            placeholder="Your full name"
            className="w-full border-2 border-input rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      )}

      <div className="space-y-4 max-h-[45vh] overflow-y-auto pr-1">
        <FieldList
          fields={fields}
          values={values}
          setValues={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
          onOpenSignature={(f) => setModalField(f)}
          signatureDisabled={!signerName.trim()}
        />
      </div>

      {error && (
        <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      <Button onClick={handleContinue} className="w-full">Continue</Button>
    </div>
  )
}
