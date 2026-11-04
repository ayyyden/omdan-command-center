"use client"

import { useState } from "react"
import { CheckCircle2, XCircle, Loader2, PenLine, Clock } from "lucide-react"
import { SignatureModal } from "@/components/contracts/signature-modal"
import { ESTIMATE_COMPANY } from "@/lib/estimate-format"

interface Props {
  token: string
  initialStatus: string
  approvedAt: string | null
  customerName: string
  signerName: string | null
  expired: boolean
  validUntil: string | null
}

type UIState = "idle" | "loading" | "approved" | "declined"

// Approve & sign: e-sign consent, typed full name, drawn signature. The
// signature goes into the client signature box of the signed estimate PDF.
export function ApproveClient({ token, initialStatus, approvedAt, customerName, signerName, expired, validUntil }: Props) {
  const [state, setState] = useState<UIState>(() => (initialStatus === "approved" ? "approved" : initialStatus === "rejected" ? "declined" : "idle"))
  const [error, setError] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [name, setName] = useState(customerName)
  const [signature, setSignature] = useState<string | null>(null)
  const [padOpen, setPadOpen] = useState(false)
  const [confirmDecline, setConfirmDecline] = useState(false)

  async function submit(action: "approve" | "decline") {
    setState("loading"); setError(null)
    try {
      const res = await fetch("/api/estimates/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, action, signerName: name.trim(), signature }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error ?? "Something went wrong. Please try again."); setState("idle"); return }
      setState(action === "approve" ? "approved" : "declined")
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" })
    } catch {
      setError("Network error. Please try again."); setState("idle")
    }
  }

  if (state === "approved") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="grid place-items-center w-14 h-14 rounded-full bg-green-100"><CheckCircle2 className="w-7 h-7 text-green-600" /></div>
        <h2 className="text-xl font-semibold text-[#1E2320]">Estimate signed — thank you!</h2>
        <p className="text-sm text-[#6B6F73] max-w-sm">
          {signerName || name ? `Signed by ${signerName || name}. ` : ""}A signed copy is on its way to your email. We&apos;ll be in touch shortly to schedule your project.
        </p>
        {approvedAt && <p className="text-xs text-[#8A8E92]">Signed on {new Date(approvedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</p>}
        <a href={`/api/estimates/public-pdf/${token}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[#A88532] underline underline-offset-2">View the signed estimate</a>
      </div>
    )
  }

  if (state === "declined") {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <div className="grid place-items-center w-14 h-14 rounded-full bg-gray-100"><XCircle className="w-7 h-7 text-gray-400" /></div>
        <h2 className="text-xl font-semibold text-[#1E2320]">We received your response</h2>
        <p className="text-sm text-[#6B6F73] max-w-sm">If you&apos;d like to talk about changes, call us at {ESTIMATE_COMPANY.phone}.</p>
      </div>
    )
  }

  if (expired) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="grid place-items-center w-14 h-14 rounded-full bg-amber-100"><Clock className="w-7 h-7 text-amber-600" /></div>
        <h2 className="text-lg font-semibold text-[#1E2320]">This estimate expired{validUntil ? ` on ${validUntil}` : ""}</h2>
        <p className="text-sm text-[#6B6F73] max-w-sm">
          Please contact us for an updated estimate — call <a className="underline" href={`tel:${ESTIMATE_COMPANY.phone.replace(/\D/g, "")}`}>{ESTIMATE_COMPANY.phone}</a> or email{" "}
          <a className="underline" href={`mailto:${ESTIMATE_COMPANY.email}`}>{ESTIMATE_COMPANY.email}</a>.
        </p>
      </div>
    )
  }

  const canSign = consent && reviewed && name.trim().length >= 2 && !!signature && state !== "loading"

  return (
    <div className="flex flex-col gap-4">
      {padOpen && (
        <SignatureModal
          type="signature"
          signerName={name}
          onDone={(dataUrl) => { setSignature(dataUrl); setPadOpen(false) }}
          onCancel={() => setPadOpen(false)}
        />
      )}

      <div>
        <h2 className="text-lg font-semibold text-[#1E2320]">Approve &amp; sign</h2>
        <p className="text-sm text-[#6B6F73]">{validUntil ? `Valid until ${validUntil}.` : ""} Signing accepts the scope, price and payment schedule above.</p>
      </div>

      <div className="space-y-2.5 p-4 rounded-xl bg-white border border-[#E4DED0]">
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#1E2320]" />
          <span className="text-sm text-[#44484C] leading-relaxed">I agree to use electronic records and an electronic signature for this estimate.</span>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#1E2320]" />
          <span className="text-sm text-[#44484C] leading-relaxed">I reviewed the scope of work, total price and payment schedule, and I agree to them.</span>
        </label>
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-[#1E2320]">Your full name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name, as you'd sign it"
          className="w-full border-2 border-[#D9D2C2] rounded-lg px-3.5 py-3 text-base focus:outline-none focus:border-[#1E2320]"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-sm font-semibold text-[#1E2320]">Your signature</label>
        <button
          type="button"
          onClick={() => setPadOpen(true)}
          disabled={name.trim().length < 2}
          className="w-full min-h-[104px] rounded-lg border-2 border-dashed border-[#D9D2C2] hover:border-[#A88532] bg-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center p-3 transition-colors"
        >
          {signature ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signature} alt="Your signature" className="max-h-20 object-contain" />
          ) : (
            <span className="flex items-center gap-2 text-sm font-medium text-[#6B6F73]">
              <PenLine className="w-4 h-4" />{name.trim().length < 2 ? "Type your name first" : "Tap to sign"}
            </span>
          )}
        </button>
        {signature && <button type="button" onClick={() => setPadOpen(true)} className="text-xs font-medium text-[#A88532]">Redo signature</button>}
      </div>

      <button
        onClick={() => submit("approve")}
        disabled={!canSign}
        className="flex items-center justify-center gap-2 w-full py-4 px-6 bg-[#1E2320] hover:bg-black disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-base transition-colors"
      >
        {state === "loading" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-5 h-5 text-[#C9A246]" />}
        {state === "loading" ? "Signing…" : "Approve & Sign Estimate"}
      </button>

      {!confirmDecline ? (
        <button onClick={() => setConfirmDecline(true)} disabled={state === "loading"} className="text-sm text-[#6B6F73] hover:text-[#22262A] underline underline-offset-2 self-center">
          Decline this estimate
        </button>
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm">
          <span className="text-[#6B6F73]">Decline it?</span>
          <button onClick={() => submit("decline")} className="px-3 py-1.5 rounded-lg border border-[#D9D2C2] bg-white hover:bg-gray-50 font-medium">Yes, decline</button>
          <button onClick={() => setConfirmDecline(false)} className="px-3 py-1.5 rounded-lg text-[#6B6F73]">Cancel</button>
        </div>
      )}

      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
    </div>
  )
}
