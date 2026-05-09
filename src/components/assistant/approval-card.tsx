"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  CheckCircle, XCircle, AlertCircle, Loader2,
  FileText, Calendar, StickyNote, Receipt, Send,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActionDraft {
  type: string
  summary: string
  payload: Record<string, unknown>
  risk_level?: "low" | "medium" | "high"
}

interface ApprovalCardProps {
  actionId:       string
  conversationId: string
  action:         ActionDraft
  initialStatus?: string
  initialResult?: Record<string, unknown> | null
}

// ─── Action config ────────────────────────────────────────────────────────────

const ACTION_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  create_invoice:      { label: "Create Draft Invoice",  icon: Receipt,   color: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
  create_send_invoice: { label: "Send Invoice",          icon: Send,      color: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300" },
  create_estimate:     { label: "Create Draft Estimate", icon: FileText,  color: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300" },
  schedule_job:        { label: "Schedule Job",          icon: Calendar,  color: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
  update_note:         { label: "Update Note",           icon: StickyNote, color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300" },
  send_contracts:      { label: "Send Contracts",        icon: Send,      color: "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300" },
}

const RISK_COLOR: Record<string, string> = {
  low:    "bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800/40",
  medium: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800/40",
  high:   "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800/40",
}

// ─── Payload renderer ─────────────────────────────────────────────────────────

function PayloadRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-muted-foreground w-28 shrink-0">{label}</span>
      <span className="font-medium text-foreground break-words">{value}</span>
    </div>
  )
}

function renderPayload(type: string, payload: Record<string, unknown>) {
  const fmt = (n: unknown) =>
    n == null ? null : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0 })}`

  if (type === "create_invoice" || type === "create_send_invoice") {
    return (
      <>
        <PayloadRow label="Customer" value={payload.customer_name as string} />
        <PayloadRow label="Job"      value={payload.job_title as string | null} />
        <PayloadRow label="Amount"   value={fmt(payload.amount)} />
        <PayloadRow label="Type"     value={payload.type as string} />
        {type === "create_send_invoice" && (
          <PayloadRow label="Send to" value={payload.customer_email as string | null} />
        )}
        <PayloadRow label="Due date" value={payload.due_date as string | null} />
        <PayloadRow label="Payment"  value={(payload.payment_methods as string[] | null)?.join(", ")} />
      </>
    )
  }

  if (type === "create_estimate") {
    const steps = payload.payment_steps as Array<{ name: string; amount: number }> | null
    return (
      <>
        <PayloadRow label="Customer" value={payload.customer_name as string} />
        <PayloadRow label="Services" value={payload.services as string} />
        <PayloadRow label="Total"    value={fmt(payload.total)} />
        {steps?.length ? (
          <PayloadRow
            label="Schedule"
            value={steps.map((s) => `${s.name}: ${fmt(s.amount)}`).join(" · ")}
          />
        ) : null}
      </>
    )
  }

  if (type === "schedule_job") {
    return (
      <>
        <PayloadRow label="Job"  value={payload.job_title as string} />
        <PayloadRow label="Date" value={payload.new_scheduled_date as string} />
        <PayloadRow label="Time" value={payload.new_scheduled_time as string | null} />
      </>
    )
  }

  if (type === "update_note") {
    const note = payload.notes as string
    return (
      <>
        <PayloadRow label="Entity" value={`${payload.entity_type}: ${payload.entity_name}`} />
        <div className="text-xs mt-1">
          <span className="text-muted-foreground">Notes: </span>
          <span className="font-medium text-foreground line-clamp-3 whitespace-pre-wrap">{note}</span>
        </div>
      </>
    )
  }

  return null
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ApprovalCard({
  actionId,
  conversationId,
  action,
  initialStatus = "pending",
  initialResult = null,
}: ApprovalCardProps) {
  const [status, setStatus]     = useState(initialStatus)
  const [result, setResult]     = useState<Record<string, unknown> | null>(initialResult)
  const [loading, setLoading]   = useState(false)
  const [errMsg,  setErrMsg]    = useState<string | null>(null)

  const meta = ACTION_META[action.type] ?? { label: action.type, icon: AlertCircle, color: "bg-gray-100 text-gray-700" }
  const Icon = meta.icon
  const riskLevel = action.risk_level ?? "low"
  const riskClass = RISK_COLOR[riskLevel] ?? RISK_COLOR.low

  async function handleAction(choice: "approve" | "reject") {
    setLoading(true)
    setErrMsg(null)
    try {
      const res  = await fetch(`/api/assistant/conversations/${conversationId}/actions/${actionId}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ action: choice }),
      })
      const data = await res.json()
      if (!res.ok) {
        setErrMsg(data.error ?? "Something went wrong")
        setStatus("pending")
      } else {
        setStatus(data.status)
        setResult(data.result ?? null)
      }
    } catch {
      setErrMsg("Network error — please try again")
    } finally {
      setLoading(false)
    }
  }

  const isDone = status !== "pending"

  return (
    <div className={`rounded-xl border p-3.5 text-sm space-y-2.5 ${riskClass}`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
          {meta.label}
        </span>
        {isDone && (
          <StatusBadge status={status} />
        )}
      </div>

      {/* Summary */}
      <p className="font-medium text-foreground leading-snug">{action.summary}</p>

      {/* Payload details */}
      <div className="space-y-1 py-1 border-t border-current/10">
        {renderPayload(action.type, action.payload)}
      </div>

      {/* Error */}
      {errMsg && (
        <p className="text-xs text-destructive">{errMsg}</p>
      )}

      {/* Result link */}
      {status === "executed" && result && <ExecutedResult type={action.type} result={result} />}

      {/* Buttons */}
      {!isDone && (
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            disabled={loading}
            onClick={() => handleAction("approve")}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 mr-1" />}
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-3 text-xs"
            disabled={loading}
            onClick={() => handleAction("reject")}
          >
            <XCircle className="w-3.5 h-3.5 mr-1" />
            Reject
          </Button>
        </div>
      )}
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    executed: { label: "Done",     cls: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" },
    rejected: { label: "Rejected", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    failed:   { label: "Failed",   cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
    approved: { label: "Approved", cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" },
    expired:  { label: "Expired",  cls: "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400" },
  }
  const info = map[status] ?? { label: status, cls: "bg-gray-100 text-gray-600" }
  return (
    <Badge className={`text-[10px] px-1.5 py-0 h-4 ${info.cls}`}>{info.label}</Badge>
  )
}

function ExecutedResult({ type, result }: { type: string; result: Record<string, unknown> }) {
  const appUrl = ""  // relative links work fine in the browser
  const links: Array<{ label: string; href: string }> = []

  if (type === "create_invoice" || type === "create_send_invoice") {
    if (result.invoice_id) links.push({ label: "View Invoice", href: `${appUrl}/invoices/${result.invoice_id}` })
  }
  if (type === "create_estimate") {
    if (result.estimate_id) links.push({ label: "View Estimate", href: `${appUrl}/estimates/${result.estimate_id}` })
  }
  if (type === "schedule_job") {
    if (result.job_id) links.push({ label: "View Job", href: `${appUrl}/jobs/${result.job_id}` })
  }

  if (!links.length) return null
  return (
    <div className="flex gap-2 pt-1">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className="text-xs underline text-muted-foreground hover:text-foreground"
        >
          {l.label}
        </a>
      ))}
    </div>
  )
}
