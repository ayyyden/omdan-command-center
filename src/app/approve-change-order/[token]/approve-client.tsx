"use client"

import { useState } from "react"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"

interface Props {
  token: string
  initialStatus: string
  approvedAt: string | null
}

type UIState = "idle" | "loading" | "approved" | "declined"

export function ApproveChangeOrderClient({ token, initialStatus, approvedAt }: Props) {
  const [state, setState] = useState<UIState>(() => {
    if (initialStatus === "approved") return "approved"
    if (initialStatus === "rejected") return "declined"
    return "idle"
  })
  const [error, setError] = useState<string | null>(null)

  async function submit(action: "approve" | "decline") {
    setState("loading")
    setError(null)
    try {
      const res = await fetch("/api/change-orders/approve", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token, action }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.")
        setState("idle")
        return
      }
      setState(action === "approve" ? "approved" : "declined")
    } catch {
      setError("Network error. Please try again.")
      setState("idle")
    }
  }

  if (state === "approved") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
          <CheckCircle2 className="w-8 h-8 text-green-600" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Change Order Approved</h2>
          <p className="text-gray-500 text-sm mt-1 max-w-xs mx-auto">
            Thank you! We'll proceed with the additional work.
          </p>
        </div>
        {approvedAt && (
          <p className="text-xs text-gray-400">
            Approved on{" "}
            {new Date(approvedAt).toLocaleDateString("en-US", {
              month: "long", day: "numeric", year: "numeric",
            })}
          </p>
        )}
      </div>
    )
  }

  if (state === "declined") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="flex items-center justify-center w-16 h-16 rounded-full bg-gray-100">
          <XCircle className="w-8 h-8 text-gray-400" />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Change Order Declined</h2>
          <p className="text-gray-500 text-sm mt-1 max-w-xs mx-auto">
            We've received your response. Contact us if you have any questions.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        onClick={() => submit("approve")}
        disabled={state === "loading"}
        className="flex items-center justify-center gap-2 w-full py-3.5 px-6 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white font-semibold rounded-xl text-sm transition-colors"
      >
        {state === "loading" ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <CheckCircle2 className="w-4 h-4" />
        )}
        Approve Change Order
      </button>
      <button
        onClick={() => submit("decline")}
        disabled={state === "loading"}
        className="flex items-center justify-center gap-2 w-full py-3 px-6 bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-600 font-medium rounded-xl text-sm border border-gray-200 transition-colors"
      >
        Decline
      </button>
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
    </div>
  )
}
