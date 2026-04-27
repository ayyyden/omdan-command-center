import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Button } from "@/components/ui/button"
import { CustomersBulkTable } from "@/components/customers/customers-bulk-table"
import { AlertTriangle, Plus } from "lucide-react"
import Link from "next/link"
import type { LeadStatus } from "@/types"

// ── Pipeline definition ──────────────────────────────────────────────────────

const PIPELINE_STAGES: { status: LeadStatus; label: string }[] = [
  { status: "New Lead",          label: "New Lead" },
  { status: "Contacted",         label: "Contacted" },
  { status: "Estimate Sent",     label: "Estimate Sent" },
  { status: "Follow-Up Needed",  label: "Follow-Up" },
  { status: "Approved",          label: "Approved" },
  { status: "Scheduled",         label: "Scheduled" },
  { status: "In Progress",       label: "In Progress" },
  { status: "Completed",         label: "Completed" },
  { status: "Paid",              label: "Paid" },
]

const ACTIVE_STAGES = new Set<string>([
  "New Lead", "Contacted", "Estimate Sent", "Follow-Up Needed", "Approved",
])

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000)
}

// ── Page ─────────────────────────────────────────────────────────────────────

interface PageProps {
  searchParams: Promise<{ status?: string; q?: string; archived?: string }>
}

export default async function CustomersPage({ searchParams }: PageProps) {
  const { status, q, archived } = await searchParams
  const isArchived = archived === "true"
  const supabase   = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Three parallel fetches
  let filteredQuery = supabase
    .from("customers")
    .select("*")
    .eq("is_archived", isArchived)
    .order("updated_at", { ascending: false })

  if (!isArchived && status) filteredQuery = filteredQuery.eq("status", status)
  if (q) filteredQuery = filteredQuery.ilike("name", `%${q}%`)

  const [
    { data: customers },
    { data: allActive },
    { data: recentComms },
  ] = await Promise.all([
    filteredQuery,
    // counts for pipeline tabs — only non-archived
    supabase.from("customers").select("id, status, updated_at").eq("is_archived", false),
    // most recent communication per customer (ordered; we'll take first match per customer_id)
    supabase
      .from("communication_logs")
      .select("customer_id, created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
  ])

  // Build last-contact map: customer_id → most recent created_at
  const lastContactMap = new Map<string, string>()
  for (const log of recentComms ?? []) {
    if (log.customer_id && !lastContactMap.has(log.customer_id)) {
      lastContactMap.set(log.customer_id, log.created_at)
    }
  }

  // Stage counts from allActive
  const stageCounts: Record<string, number> = {}
  for (const c of allActive ?? []) {
    stageCounts[c.status] = (stageCounts[c.status] ?? 0) + 1
  }
  const totalActive = (allActive ?? []).length

  const displayList = customers ?? []

  return (
    <div>
      <Topbar
        title="CRM / Leads"
        subtitle={`${totalActive} active leads`}
        actions={
          <Button asChild>
            <Link href="/customers/new"><Plus className="w-4 h-4 mr-2" />Add Lead</Link>
          </Button>
        }
      />

      <div className="p-4 sm:p-6 space-y-5">

        {/* ── Pipeline stage tabs ─────────────────────────────────── */}
        <div className="overflow-x-auto pb-1">
          <div className="flex items-stretch gap-0 min-w-max rounded-lg border bg-card overflow-hidden">
            {/* All tab */}
            <Link
              href="/customers"
              className={[
                "flex flex-col items-center justify-center px-4 py-2.5 text-xs font-medium border-r transition-colors min-w-[72px]",
                !status && !isArchived
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted/60 text-muted-foreground",
              ].join(" ")}
            >
              <span className="text-base font-bold">{totalActive}</span>
              <span>All</span>
            </Link>

            {/* Pipeline stages */}
            {PIPELINE_STAGES.map((stage, i) => {
              const count   = stageCounts[stage.status] ?? 0
              const active  = !isArchived && status === stage.status
              const isLast  = i === PIPELINE_STAGES.length - 1
              return (
                <Link
                  key={stage.status}
                  href={`/customers?status=${encodeURIComponent(stage.status)}`}
                  className={[
                    "flex flex-col items-center justify-center px-4 py-2.5 text-xs font-medium transition-colors min-w-[88px]",
                    isLast ? "" : "border-r",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted/60 text-muted-foreground",
                  ].join(" ")}
                >
                  <span className={["text-base font-bold", !active && count === 0 ? "text-muted-foreground/50" : ""].join(" ")}>
                    {count}
                  </span>
                  <span className="whitespace-nowrap">{stage.label}</span>
                </Link>
              )
            })}

            {/* Divider before terminal stages */}
            <div className="w-px bg-border/60 mx-1 self-stretch" />

            <Link
              href="/customers?status=Closed+Lost"
              className={[
                "flex flex-col items-center justify-center px-4 py-2.5 text-xs font-medium border-r transition-colors min-w-[80px]",
                !isArchived && status === "Closed Lost"
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted/60 text-muted-foreground",
              ].join(" ")}
            >
              <span className="text-base font-bold">{stageCounts["Closed Lost"] ?? 0}</span>
              <span>Closed</span>
            </Link>

            <Link
              href="/customers?archived=true"
              className={[
                "flex flex-col items-center justify-center px-4 py-2.5 text-xs font-medium transition-colors min-w-[80px]",
                isArchived ? "bg-primary text-primary-foreground" : "hover:bg-muted/60 text-muted-foreground",
              ].join(" ")}
            >
              <span className="text-base font-bold">—</span>
              <span>Archived</span>
            </Link>
          </div>
        </div>

        {/* ── Follow-up alert banner ──────────────────────────────── */}
        {!isArchived && !status && (() => {
          const needsFollowUp = (allActive ?? []).filter(c => c.status === "Follow-Up Needed").length
          const staleCount    = (allActive ?? []).filter(c => {
            const lastActivity = lastContactMap.get(c.id) ?? c.updated_at
            return ACTIVE_STAGES.has(c.status) && daysSince(lastActivity) >= 7
          }).length
          if (needsFollowUp === 0 && staleCount === 0) return null
          return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-warning/40 bg-warning/5 text-sm">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
              <span className="text-warning">
                {needsFollowUp > 0 && `${needsFollowUp} lead${needsFollowUp > 1 ? "s" : ""} need follow-up`}
                {needsFollowUp > 0 && staleCount > 0 && " · "}
                {staleCount > 0 && `${staleCount} lead${staleCount > 1 ? "s" : ""} stale (7+ days no contact)`}
              </span>
              {needsFollowUp > 0 && (
                <Link href="/customers?status=Follow-Up+Needed" className="ml-auto text-xs text-warning font-medium hover:underline shrink-0">
                  View →
                </Link>
              )}
            </div>
          )
        })()}

        {/* ── Leads table ────────────────────────────────────────── */}
        <CustomersBulkTable
          customers={displayList}
          userId={user.id}
          lastContact={Object.fromEntries(lastContactMap)}
        />
      </div>
    </div>
  )
}
