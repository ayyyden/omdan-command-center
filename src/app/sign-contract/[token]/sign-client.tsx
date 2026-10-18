"use client"

import { useState } from "react"
import { SignatureModal } from "@/components/contracts/signature-modal"
import { PdfViewer } from "@/components/contracts/pdf-viewer"
import { ConsentScreen } from "./consent-screen"
import { FillForm, type SigningField } from "./fill-form"
import { firstMissingRequired } from "@/lib/contracts/choice-groups"

export interface SignDoc {
  token: string
  name: string
  fields: SigningField[]
}

interface Props {
  /** The documents still to sign, in order (one for a single contract) */
  docs: SignDoc[]
  /** How many in the whole set were already signed before this visit */
  alreadySigned?: number
  companyName: string
  companyPhone: string | null
  companyEmail: string | null
}

type Step = "consent" | "review" | "fill" | "done"

// The customer's signing session, for one document or a set sent together:
//   1. agree to sign electronically — once, for all of them
//   2. for each document: see it already filled in with the company's part
//      (Sales Person Signature, price, license…) → "Sign this document"
//   3. fill in their own part and sign → next document
// A signature drawn once can be reused with one tap on the next documents.
export function SignClient({ docs, alreadySigned = 0, companyName, companyPhone, companyEmail }: Props) {
  const [step, setStep]             = useState<Step>("consent")
  const [index, setIndex]           = useState(0)
  const [values, setValues]         = useState<Record<string, Record<string, string>>>({})
  const [signerName, setSignerName] = useState("")
  const [modalField, setModalField] = useState<SigningField | null>(null)
  const [lastMark, setLastMark]     = useState<{ signature?: string; initials?: string }>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState("")

  const total = docs.length + alreadySigned
  const doc = docs[index]
  const position = alreadySigned + index + 1
  const many = total > 1
  const previewUrl = (d: SignDoc) => `/api/contracts/preview-pdf/${d.token}`
  const docValues = values[doc?.token] ?? {}

  function setValue(id: string, v: string) {
    patchValues({ [id]: v })
  }
  function patchValues(patch: Record<string, string>) {
    setValues((prev) => ({ ...prev, [doc.token]: { ...(prev[doc.token] ?? {}), ...patch } }))
  }

  async function handleConsent() {
    setSubmitting(true)
    setError("")
    // Consent is logged on every document in the set (best effort — signing
    // itself still requires reviewing each document)
    await Promise.all(docs.map((d) => fetch(`/api/contracts/consent/${d.token}`, { method: "POST" }).catch(() => null)))
    setSubmitting(false)
    setStep("review")
    window.scrollTo(0, 0)
  }

  async function handleSubmit() {
    setError("")
    const missing = firstMissingRequired(doc.fields, docValues)
    if (missing) {
      setError(`"${missing}" is required.`)
      return
    }
    if (!signerName.trim()) {
      setError("Please enter your full name to complete signing.")
      return
    }

    setSubmitting(true)
    const res = await fetch(`/api/contracts/sign/${doc.token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerName: signerName.trim(), fieldValues: docValues }),
    })
    setSubmitting(false)

    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j.error ?? "Signing failed. Please try again.")
      return
    }

    if (index + 1 < docs.length) {
      setIndex(index + 1)
      setStep("review")
    } else {
      setStep("done")
    }
    window.scrollTo(0, 0)
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
          <h1 className="text-xl font-semibold text-gray-900 mb-2">{many ? `All ${total} documents signed` : "Contract Signed"}</h1>
          <p className="text-gray-500 mb-1">
            Thank you, <span className="font-medium text-gray-700">{signerName}</span>.
          </p>
          <p className="text-sm text-gray-400">Signed copies are on their way to your email. You may close this window.</p>
        </div>
      </div>
    )
  }

  if (step === "consent") {
    return (
      <ConsentScreen
        docs={docs.map((d) => ({ name: d.name, previewUrl: previewUrl(d) }))}
        companyName={companyName}
        companyPhone={companyPhone}
        companyEmail={companyEmail}
        submitting={submitting}
        error={error}
        onContinue={handleConsent}
      />
    )
  }

  const label = many ? `Document ${position} of ${total}` : ""

  return (
    <>
      {modalField && (
        <SignatureModal
          type={modalField.field_type as "signature" | "initials"}
          signerName={signerName}
          previous={modalField.field_type === "initials" ? lastMark.initials : lastMark.signature}
          onDone={(dataUrl) => {
            setValue(modalField.id, dataUrl)
            setLastMark((m) => ({ ...m, [modalField.field_type === "initials" ? "initials" : "signature"]: dataUrl }))
            setModalField(null)
          }}
          onCancel={() => setModalField(null)}
        />
      )}

      {step === "review" ? (
        <div className="min-h-screen bg-gray-50">
          <div className="max-w-3xl mx-auto px-4 py-6">
            <div className="mb-4">
              {many && <p className="text-sm text-slate-500 font-medium mb-1">{label} · Review</p>}
              <h1 className="text-2xl font-semibold text-slate-900">{doc.name}</h1>
              <p className="text-sm text-slate-500 mt-1">
                This is the document with {companyName}&apos;s part already filled in. Read it, then tap Sign to fill in your part.
              </p>
            </div>
            {many && <Progress total={total} done={position - 1} />}
            <PdfViewer url={previewUrl(doc)} className="mb-24" />
          </div>
          <div className="fixed inset-x-0 bottom-0 bg-white/95 backdrop-blur border-t" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
            <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
              <p className="hidden sm:block text-sm text-slate-500 flex-1 truncate">{many ? `${label}: ${doc.name}` : doc.name}</p>
              <button
                type="button"
                onClick={() => { setStep("fill"); window.scrollTo(0, 0) }}
                className="flex-1 sm:flex-none bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg px-6 py-3.5 text-base transition-colors"
              >
                Sign this document
              </button>
            </div>
          </div>
        </div>
      ) : (
        <FillForm
          token={doc.token}
          contractName={doc.name}
          pdfUrl={previewUrl(doc)}
          fields={doc.fields}
          values={docValues}
          setValues={patchValues}
          signerName={signerName}
          setSignerName={setSignerName}
          onOpenSignature={setModalField}
          submitting={submitting}
          error={error}
          onSubmit={handleSubmit}
          stepLabel={many ? `${label} · Fill & sign` : "Fill & sign"}
          submitLabel={index + 1 < docs.length ? "Sign & continue to the next document" : "Sign & Submit"}
          onBack={() => { setStep("review"); setError(""); window.scrollTo(0, 0) }}
        />
      )}
    </>
  )
}

function Progress({ total, done }: { total: number; done: number }) {
  return (
    <div className="flex gap-1.5 mb-4" aria-label={`${done} of ${total} signed`}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className={`h-1.5 flex-1 rounded-full ${i < done ? "bg-green-500" : i === done ? "bg-blue-600" : "bg-slate-200"}`} />
      ))}
    </div>
  )
}
