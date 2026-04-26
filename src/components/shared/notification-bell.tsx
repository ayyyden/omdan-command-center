"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  Bell, X, CheckCircle2, AlertTriangle, Clock,
  Send, CalendarClock, CheckCheck, XCircle, ThumbsUp, FileCheck, FileX, Star,
} from "lucide-react"
import { cn } from "@/lib/utils"

type NotifType =
  | "reminder_due"
  | "overdue_job"
  | "overdue_estimate"
  | "contract_signed"
  | "pending_contract"
  | "estimate_approved"
  | "estimate_declined"
  | "change_order_approved"
  | "change_order_rejected"
  | "review_needed"

interface Notification {
  key: string
  type: NotifType
  title: string
  subtitle: string
  href: string
}

const TYPE_CONFIG: Record<NotifType, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  reminder_due:      { label: "Reminder",           icon: CalendarClock, color: "text-blue-600 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-900/20" },
  overdue_job:       { label: "Overdue Job",         icon: AlertTriangle, color: "text-red-600 dark:text-red-400",      bg: "bg-red-50 dark:bg-red-900/20" },
  overdue_estimate:  { label: "Estimate Follow-up",  icon: Clock,         color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20" },
  contract_signed:   { label: "Contract Signed",     icon: CheckCircle2,  color: "text-green-600 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20" },
  pending_contract:  { label: "Awaiting Signature",  icon: Send,          color: "text-orange-600 dark:text-orange-400",bg: "bg-orange-50 dark:bg-orange-900/20" },
  estimate_approved:    { label: "Estimate Approved",      icon: ThumbsUp,    color: "text-green-600 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20" },
  estimate_declined:    { label: "Estimate Declined",      icon: XCircle,     color: "text-gray-500 dark:text-gray-400",    bg: "bg-gray-100 dark:bg-gray-800/40" },
  change_order_approved:{ label: "Change Order Approved",  icon: FileCheck,   color: "text-green-600 dark:text-green-400",  bg: "bg-green-50 dark:bg-green-900/20" },
  change_order_rejected:{ label: "Change Order Declined",  icon: FileX,       color: "text-gray-500 dark:text-gray-400",    bg: "bg-gray-100 dark:bg-gray-800/40" },
  review_needed:        { label: "Review Needed",          icon: Star,        color: "text-amber-600 dark:text-amber-400",  bg: "bg-amber-50 dark:bg-amber-900/20" },
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return "yesterday"
  return `${days}d ago`
}

function fmtCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n)
}

function join(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(" · ")
}

// Pure modal — no trigger button. Rendered at root level (DashboardShell).
// Triggered by: window.dispatchEvent(new CustomEvent("open-notifications"))
// Broadcasts count via: window.dispatchEvent(new CustomEvent("notification-count-update", { detail: N }))
export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const today = new Date().toISOString().split("T")[0]
    const sevenDaysAgo  = new Date(Date.now() -  7 * 86400000).toISOString()
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
    const threeDaysAgo  = new Date(Date.now() -  3 * 86400000).toISOString()
    const twoDaysAgo    = new Date(Date.now() -  2 * 86400000).toISOString().split("T")[0]

    const [
      reminders, jobs, overdueEsts, signed, pending,
      approvedEsts, declinedEsts, approvedCOs, rejectedCOs, reviewNeeded, dismissals,
    ] = await Promise.all([
      supabase
        .from("reminders")
        .select("id, title, due_date, customer:customers(name)")
        .lte("due_date", today)
        .is("completed_at", null)
        .limit(20),
      supabase
        .from("jobs")
        .select("id, title, scheduled_date, customer:customers(name)")
        .lt("scheduled_date", today)
        .in("status", ["scheduled", "in_progress"])
        .limit(20),
      supabase
        .from("estimates")
        .select("id, title, sent_at, customer:customers(name)")
        .eq("status", "sent")
        .lt("sent_at", sevenDaysAgo)
        .limit(20),
      supabase
        .from("sent_contracts")
        .select("id, signed_at, signer_name, customer:customers(name), contract_template:contract_templates(name)")
        .eq("status", "signed")
        .limit(20),
      supabase
        .from("sent_contracts")
        .select("id, sent_at, recipient_email, customer:customers(name), contract_template:contract_templates(name)")
        .eq("status", "sent")
        .lt("sent_at", threeDaysAgo)
        .limit(20),
      supabase
        .from("estimates")
        .select("id, title, total, approved_at, customer:customers(name)")
        .eq("status", "approved")
        .gt("approved_at", thirtyDaysAgo)
        .limit(20),
      supabase
        .from("estimates")
        .select("id, title, total, declined_at, customer:customers(name)")
        .eq("status", "rejected")
        .gt("declined_at", thirtyDaysAgo)
        .limit(20),
      supabase
        .from("change_orders")
        .select("id, title, amount, approved_at, customer:customers(name), job:jobs(id)")
        .eq("status", "approved")
        .gt("approved_at", thirtyDaysAgo)
        .limit(20),
      supabase
        .from("change_orders")
        .select("id, title, amount, rejected_at, customer:customers(name), job:jobs(id)")
        .eq("status", "rejected")
        .gt("rejected_at", thirtyDaysAgo)
        .limit(20),
      supabase
        .from("jobs")
        .select("id, title, completion_date, customer:customers(name)")
        .eq("status", "completed")
        .eq("review_completed", false)
        .is("review_requested_at", null)
        .not("completion_date", "is", null)
        .lt("completion_date", twoDaysAgo)
        .limit(20),
      supabase
        .from("notification_dismissals")
        .select("notification_key"),
    ])

    const dismissed = new Set((dismissals.data ?? []).map((d) => d.notification_key))

    const all: Notification[] = [
      // Approved change orders — highest priority
      ...(approvedCOs.data ?? []).map((co) => ({
        key: `change_order_approved_${co.id}`,
        type: "change_order_approved" as const,
        title: (co.customer as any)?.name ?? "Customer",
        subtitle: join(co.title, fmtCurrency(Number(co.amount)), co.approved_at ? timeAgo(co.approved_at) : undefined),
        href: `/jobs/${(co.job as any)?.id ?? ""}`,
      })),
      // Declined change orders
      ...(rejectedCOs.data ?? []).map((co) => ({
        key: `change_order_rejected_${co.id}`,
        type: "change_order_rejected" as const,
        title: (co.customer as any)?.name ?? "Customer",
        subtitle: join(co.title, fmtCurrency(Number(co.amount)), co.rejected_at ? timeAgo(co.rejected_at) : undefined),
        href: `/jobs/${(co.job as any)?.id ?? ""}`,
      })),
      // Completed jobs needing a review request (2+ days since completion)
      ...(reviewNeeded.data ?? []).map((j) => ({
        key: `review_needed_${j.id}`,
        type: "review_needed" as const,
        title: j.title,
        subtitle: join(
          (j.customer as any)?.name,
          j.completion_date ? `completed ${timeAgo(j.completion_date)}` : undefined,
        ),
        href: `/jobs/${j.id}`,
      })),
      // Approved estimates — highest priority (actionable good news)
      ...(approvedEsts.data ?? []).map((e) => ({
        key: `estimate_approved_${e.id}`,
        type: "estimate_approved" as const,
        title: (e.customer as any)?.name ?? "Customer",
        subtitle: join(e.title, fmtCurrency(Number(e.total)), e.approved_at ? timeAgo(e.approved_at) : undefined),
        href: `/estimates/${e.id}`,
      })),
      // Declined estimates
      ...(declinedEsts.data ?? []).map((e) => ({
        key: `estimate_declined_${e.id}`,
        type: "estimate_declined" as const,
        title: (e.customer as any)?.name ?? "Customer",
        subtitle: join(e.title, fmtCurrency(Number(e.total)), e.declined_at ? timeAgo(e.declined_at) : undefined),
        href: `/estimates/${e.id}`,
      })),
      // Reminders due
      ...(reminders.data ?? []).map((r) => ({
        key: `reminder_due_${r.id}`,
        type: "reminder_due" as const,
        title: r.title,
        subtitle: join((r.customer as any)?.name, `due ${r.due_date}`),
        href: "/scheduler",
      })),
      // Overdue jobs
      ...(jobs.data ?? []).map((j) => ({
        key: `overdue_job_${j.id}`,
        type: "overdue_job" as const,
        title: j.title,
        subtitle: join((j.customer as any)?.name, j.scheduled_date ? `was ${j.scheduled_date}` : undefined),
        href: `/jobs/${j.id}`,
      })),
      // Estimates sent 7+ days ago without response
      ...(overdueEsts.data ?? []).map((e) => ({
        key: `overdue_estimate_${e.id}`,
        type: "overdue_estimate" as const,
        title: e.title,
        subtitle: join((e.customer as any)?.name, e.sent_at ? `sent ${timeAgo(e.sent_at)}` : undefined),
        href: `/estimates/${e.id}`,
      })),
      // Signed contracts
      ...(signed.data ?? []).map((c) => ({
        key: `contract_signed_${c.id}`,
        type: "contract_signed" as const,
        title: (c.contract_template as any)?.name ?? "Contract",
        subtitle: join(c.signer_name ?? (c.customer as any)?.name, c.signed_at ? timeAgo(c.signed_at) : undefined),
        href: "/contracts",
      })),
      // Contracts pending signature 3+ days
      ...(pending.data ?? []).map((c) => ({
        key: `pending_contract_${c.id}`,
        type: "pending_contract" as const,
        title: (c.contract_template as any)?.name ?? "Contract",
        subtitle: join((c.customer as any)?.name ?? c.recipient_email, c.sent_at ? `sent ${timeAgo(c.sent_at)}` : undefined),
        href: "/contracts",
      })),
    ].filter((n) => !dismissed.has(n.key))

    setNotifications(all)
    setLoading(false)
  }, [])

  useEffect(() => { fetchNotifications() }, [fetchNotifications])

  // Poll every 30 seconds
  useEffect(() => {
    const id = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(id)
  }, [fetchNotifications])

  // Refresh on tab/window focus
  useEffect(() => {
    window.addEventListener("focus", fetchNotifications)
    return () => window.removeEventListener("focus", fetchNotifications)
  }, [fetchNotifications])

  // Broadcast count to sidebar button and mobile strip
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("notification-count-update", { detail: notifications.length }))
  }, [notifications.length])

  // Open trigger from any bell button — also refreshes on open
  useEffect(() => {
    const handler = () => { setOpen(true); fetchNotifications() }
    window.addEventListener("open-notifications", handler)
    return () => window.removeEventListener("open-notifications", handler)
  }, [fetchNotifications])

  async function dismiss(key: string) {
    const supabase = createClient()
    await supabase
      .from("notification_dismissals")
      .upsert({ notification_key: key }, { onConflict: "user_id,notification_key" })
    setNotifications((prev) => prev.filter((n) => n.key !== key))
  }

  async function dismissAll() {
    if (notifications.length === 0) return
    const supabase = createClient()
    await supabase
      .from("notification_dismissals")
      .upsert(
        notifications.map((n) => ({ notification_key: n.key })),
        { onConflict: "user_id,notification_key" },
      )
    setNotifications([])
  }

  const count = notifications.length

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4 sm:px-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-md bg-card rounded-xl shadow-2xl border border-border flex flex-col overflow-hidden max-h-[78vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-foreground" />
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {count > 0 && (
              <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full leading-none">
                {count}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {count > 0 && (
              <button
                onClick={dismissAll}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-accent transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Dismiss all
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : count === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <CheckCircle2 className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">All clear</p>
              <p className="text-xs text-muted-foreground/60 mt-1">No pending notifications</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/50">
              {notifications.map((n) => {
                const cfg = TYPE_CONFIG[n.type]
                const Icon = cfg.icon
                return (
                  <li
                    key={n.key}
                    className="group flex items-start gap-3 px-4 py-3 hover:bg-accent/30 transition-colors"
                  >
                    <div className={cn("mt-0.5 flex items-center justify-center w-7 h-7 rounded-full shrink-0", cfg.bg)}>
                      <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground leading-tight truncate">{n.title}</p>
                      {n.subtitle && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{n.subtitle}</p>
                      )}
                      <p className={cn("text-[10px] font-semibold uppercase tracking-wide mt-1", cfg.color)}>
                        {cfg.label}
                      </p>
                    </div>
                    <button
                      onClick={() => dismiss(n.key)}
                      className="shrink-0 mt-0.5 p-1 rounded text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-all"
                      aria-label="Dismiss"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
