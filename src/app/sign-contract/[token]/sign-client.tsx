"use client"

import { useState } from "react"
import { SignatureModal } from "./signature-modal"
import { ConsentScreen } from "./consent-screen"
import { FillForm, type SigningField } from "./fill-form"

interface Props {
  token: string
  contractName: string
  pdfUrl: string | null
  fields: SigningField[]
  bundleToken?: string
  companyName: string
  companyPhone: string | null
  companyEmail: string | null
}

type Step = "consent" | "fill" | "done"

export function SignClient({
  token, contractName, pdfUrl, fields, bundleToken, companyName, companyPhone, companyEmail,
}: Props) {
  const [step, setStep]             = useState<Step>("consent")
  const [values, setValues]         = useState<Record<string, string>>({})
  const [signerName, setSignerName] = useState("")
  const [modalField, setModalField] = useState<SigningField | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState("")

  function setValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }))
  }

  async function handleConsent() {
    setSubmitting(true)
    setError("")
    try {
      await fetch(`/api/contracts/consent/${token}`, { method: "POST" })
    } catch { /* non-fatal — consent is logged best-effort, signing itself still requires review */ }
    setSubmitting(false)
    setStep("fill")
  }

  async function handleSubmit() {
    setError("")

    for (const f of fields) {
      if (f.required) {
        const v = values[f.id] ?? ""
        if (!v.trim()) {
          setError(`"${f.label}" is required.`)
          return
        }
      }
    }

    if (!signerName.trim()) {
      setError("Please enter your full name to complete signing.")
      return
    }

    setSubmitting(true)

    const res = await fetch(`/api/contracts/sign/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerName: signerName.trim(), fieldValues: values }),
    })

    setSubmitting(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? "Signing failed. Please try again.")
      return
    }

    if (bundleToken) {
      window.location.href = `/sign-bundle/${bundleToken}`
    } else {
      setStep("done")
    }
  }

  if (step === "done") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Contract Signed</h1>
          <p className="text-gray-500 mb-1">
            Thank you, <span className="font-medium text-gray-700">{signerName}</span>.
          </p>
          <p className="text-sm text-gray-400">A signed copy is on its way to your email. You may close this window.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {modalField && (
        <SignatureModal
          type={modalField.field_type as "signature" | "initials"}
          signerName={signerName}
          onDone={(dataUrl) => {
            setValue(modalField.id, dataUrl)
            setModalField(null)
          }}
          onCancel={() => setModalField(null)}
        />
      )}

      {step === "consent" ? (
        <ConsentScreen
          contractName={contractName}
          pdfUrl={pdfUrl}
          companyName={companyName}
          companyPhone={companyPhone}
          companyEmail={companyEmail}
          submitting={submitting}
          error={error}
          onContinue={handleConsent}
        />
      ) : (
        <FillForm
          contractName={contractName}
          pdfUrl={pdfUrl}
          fields={fields}
          values={values}
          setValue={setValue}
          signerName={signerName}
          setSignerName={setSignerName}
          onOpenSignature={setModalField}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
        />
      )}
    </>
  )
}
