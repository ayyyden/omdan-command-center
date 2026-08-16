"use client"

import { useState } from "react"

interface Props {
  token: string
  contractName: string
  pdfUrl: string | null
  companyName: string
  companyPhone: string | null
  companyEmail: string | null
  submitting: boolean
  error: string
  onContinue: () => void
}

// The ESIGN Act (15 U.S.C. §7001) / California UETA consent screen — shown
// before any document content, not two checkboxes buried above a Submit
// button. Covers the required disclosures: legal equivalence of an
// electronic signature, the right to a paper copy instead, the right to
// withdraw consent, what's needed to view/keep the record, and requires the
// signer to actually look at the document before consenting.
export function ConsentScreen({
  token, contractName, pdfUrl, companyName, companyPhone, companyEmail, submitting, error, onContinue,
}: Props) {
  const [viewedChecked, setViewedChecked] = useState(false)
  const [consentChecked, setConsentChecked] = useState(false)

  const contactLine = [companyPhone, companyEmail].filter(Boolean).join(" or ")
  // Shows whatever staff already filled in (Sales Person Signature, price,
  // license number, etc.) stamped onto the document, not the raw blank
  // original — the customer should see exactly what they're being asked
  // to sign, not a template with someone else's part missing.
  const previewUrl = `/api/contracts/preview-pdf/${token}`

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-slate-500 font-medium mb-1">Step 1 of 2 · Electronic signature consent</p>
          <h1 className="text-2xl font-semibold text-slate-900">{contractName}</h1>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-6 space-y-5">
          <div>
            <h2 className="text-base font-semibold text-slate-900 mb-2">
              Electronic Record and Signature Disclosure
            </h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              {companyName} would like you to sign this document electronically. Before you do,
              please review the following — this has the same legal effect as reviewing a paper
              disclosure form before signing by hand.
            </p>
          </div>

          <div className="space-y-3 text-sm text-slate-600 leading-relaxed">
            <div className="flex gap-2.5">
              <span className="font-semibold text-slate-800 shrink-0">1.</span>
              <p>
                <span className="font-medium text-slate-800">Your electronic signature is legally binding.</span>{" "}
                By signing electronically, you agree that your electronic signature is the legal
                equivalent of your handwritten signature, and that this document is as valid and
                enforceable as a paper original.
              </p>
            </div>
            <div className="flex gap-2.5">
              <span className="font-semibold text-slate-800 shrink-0">2.</span>
              <p>
                <span className="font-medium text-slate-800">You may request a paper copy instead.</span>{" "}
                You are not required to sign electronically. If you'd prefer a paper copy of this
                document to sign by hand, contact us{contactLine ? ` at ${contactLine}` : ""} before
                continuing and we'll provide one at no charge.
              </p>
            </div>
            <div className="flex gap-2.5">
              <span className="font-semibold text-slate-800 shrink-0">3.</span>
              <p>
                <span className="font-medium text-slate-800">You may withdraw consent at any time before signing.</span>{" "}
                If you change your mind, simply close this page without signing — nothing is
                final until you complete and submit your signature below, and no electronic
                signature will be applied.
              </p>
            </div>
            <div className="flex gap-2.5">
              <span className="font-semibold text-slate-800 shrink-0">4.</span>
              <p>
                <span className="font-medium text-slate-800">What you'll need.</span>{" "}
                A device with a modern web browser and a valid email address — we'll send your
                signed copy there. No special software is required. You can save or print the
                signed PDF from that email at any time.
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200">
            <p className="text-sm font-medium text-slate-800 mb-2">
              Please open and review the document before continuing:
            </p>
            {pdfUrl ? (
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700 underline underline-offset-2"
              >
                Open "{contractName}" in a new tab
              </a>
            ) : (
              <p className="text-sm text-red-600">Could not load the document — contact the sender for a new link.</p>
            )}
          </div>

          {error && (
            <div className="text-sm font-medium text-red-700 bg-red-50 border border-red-300 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="pt-2 border-t border-slate-200 space-y-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={viewedChecked}
                onChange={(e) => setViewedChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span className="text-sm text-slate-700">
                I was able to open and read the document above.
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
              />
              <span className="text-sm text-slate-700">
                I consent to sign this document electronically and understand my electronic
                signature is the legal equivalent of my handwritten signature.
              </span>
            </label>

            <button
              type="button"
              onClick={onContinue}
              disabled={submitting || !viewedChecked || !consentChecked || !pdfUrl}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-4 py-3 transition-colors text-sm mt-2"
            >
              {submitting ? "Please wait…" : "Continue to Document"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
