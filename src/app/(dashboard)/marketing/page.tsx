import { redirect } from "next/navigation"
import { AlertTriangle, CheckCircle2, Info } from "lucide-react"
import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { createServiceClient } from "@/lib/supabase/service"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { metaConfigured } from "@/lib/meta-ads"
import { AD_URL_PARAMETERS } from "@/lib/meta-attribution"
import { activeEntities, loadAdData, metricsFor } from "@/lib/meta-ads-data"
import { addDays, contactStats, regionBreakdown, type DayRow } from "@/lib/meta-ads-metrics"
import { ActionList, type AdAction } from "@/components/marketing/action-list"
import { CampaignTable, type TableEntity } from "@/components/marketing/campaign-table"
import { CopyText, ReportHistory, SettingsForm, SyncButtons, TrendChart, type ReportRow } from "@/components/marketing/advisor-panels"

export const dynamic = "force-dynamic"

interface PageProps { searchParams: Promise<{ range?: string }> }

const money = (n: number | null | undefined) => n == null ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`

export default async function AdAdvisorPage({ searchParams }: PageProps) {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "marketing:view")) redirect("/access-denied")
  const { range: rangeParam } = await searchParams
  const days = rangeParam === "30" ? 30 : rangeParam === "14" ? 14 : 7

  // Ad tables are read with the service client after the permission check above
  const service = createServiceClient()

  const [data, { data: health }, { data: actions }, { data: reports }] = await Promise.all([
    loadAdData(service, { days: 60 }),
    service.from("meta_ad_health").select("checked_at, ok, account, problems").order("checked_at", { ascending: false }).limit(1).maybeSingle(),
    service.from("meta_ad_actions").select("*").in("status", ["open", "done"]).order("created_at", { ascending: false }).limit(80),
    service.from("meta_ad_reports").select("*").order("period_start", { ascending: false }).limit(60),
  ])

  // Connected = token set here, or the latest health check reached the account
  const configured = metaConfigured() || !!(health?.account)
  const period = { start: addDays(data.today, -(days - 1)), end: data.today }

  // Latest verdict per entity from the most recent report that covered it
  const verdicts = new Map<string, { verdict: string; confidence: string; reason: string }>()
  for (const r of (reports ?? []) as ReportRow[]) {
    for (const e of (r.payload.entities ?? []) as { entity_id?: string; verdict: string; confidence: string; reason: string }[]) {
      if (e.entity_id && !verdicts.has(e.entity_id)) verdicts.set(e.entity_id, e)
    }
  }

  const toRow = (e: (typeof data.entities)[number]): TableEntity => {
    const v = verdicts.get(e.id)
    return {
      id: e.id, name: e.name, status: e.effective_status, daily_budget: e.daily_budget, thumbnail_url: e.thumbnail_url,
      metrics: metricsFor(data, e, period),
      verdict: v?.verdict ?? null, confidence: v?.confidence ?? null, verdict_reason: v?.reason ?? null,
      ads: [],
    }
  }
  const ads = activeEntities(data, ["ad"], days)
  const campaigns: TableEntity[] = activeEntities(data, ["campaign"], days)
    .map((c) => ({ ...toRow(c), ads: ads.filter((a) => a.campaign_id === c.id).map(toRow).sort((a, b) => b.metrics.spend - a.metrics.spend) }))
    .sort((a, b) => b.metrics.spend - a.metrics.spend)

  // Account totals for the period (campaign level only, so nothing is double counted)
  const campaignRows: DayRow[] = data.entities.filter((e) => e.level === "campaign").flatMap((e) => data.rowsBy.get(e.id) ?? [])
  const inPeriod = campaignRows.filter((r) => r.date >= period.start && r.date <= period.end)
  const spend = inPeriod.reduce((s, r) => s + r.spend, 0)
  const leadsMeta = inPeriod.reduce((s, r) => s + r.leads, 0)
  const periodLeads = data.leads.filter((l) => l.date >= period.start && l.date <= period.end)
  const contact = contactStats(periodLeads, data.settings.min_call_attempts, data.today)

  // 30-day trend
  const trend = Array.from({ length: 30 }, (_, i) => {
    const date = addDays(data.today, i - 29)
    const rows = campaignRows.filter((r) => r.date === date)
    const s = rows.reduce((a, r) => a + r.spend, 0), l = rows.reduce((a, r) => a + r.leads, 0)
    return { date, spend: Math.round(s * 100) / 100, leads: l, cpl: l ? Math.round((s / l) * 100) / 100 : null }
  })

  const regions = regionBreakdown(campaignRows, data.leads, data.settings, { start: addDays(data.today, -29), end: data.today }, data.today)
  const problems = (health?.problems ?? []) as { code: string; message: string; critical: boolean }[]
  const tz = (health?.account as { timezone_name?: string } | null)?.timezone_name ?? null

  return (
    <div>
      <Topbar title="Ad Advisor" subtitle="Your Meta ads, judged on real appointments and sales" actions={<SyncButtons configured={configured} />} />

      <div className="p-4 sm:p-6 space-y-5">
        {/* ── Banners ─────────────────────────────────────────────── */}
        {!configured && (
          <Banner tone="info" title="Meta isn't connected yet">
            Follow the setup steps at the bottom of this page. Until then, leads are still tracked and attributed from their ad links.
          </Banner>
        )}
        {problems.filter((p) => p.code !== "not_configured").map((p) => (
          <Banner key={p.code} tone={p.critical ? "danger" : "warn"} title={p.critical ? "Needs attention now" : "Heads up"}>{p.message}</Banner>
        ))}
        {tz && tz !== "America/Los_Angeles" && (
          <Banner tone="warn" title="Ad account timezone">
            Your ad account runs on {tz}, so &quot;daily&quot; numbers here follow that timezone, not Pacific time.
          </Banner>
        )}
        {data.unattributed > 0 && (
          <Banner tone="info" title={`${data.unattributed} lead${data.unattributed === 1 ? "" : "s"} not tied to an ad`}>
            Usually leads older than Meta&apos;s 90-day limit, or website bookings from ads without the URL parameters below.
          </Banner>
        )}
        {configured && health?.ok && !problems.length && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CheckCircle2 className="w-3.5 h-3.5 text-success" /> Meta connected · last checked {new Date(health.checked_at).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
        )}

        {/* ── What to do ──────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">What to do</CardTitle></CardHeader>
          <CardContent><ActionList actions={(actions ?? []) as AdAction[]} /></CardContent>
        </Card>

        {/* ── Totals ──────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[7, 14, 30].map((d) => (
            <a key={d} href={`/marketing${d === 7 ? "" : `?range=${d}`}`}
              className={`rounded-full border px-3 py-1 ${days === d ? "bg-primary text-primary-foreground border-transparent" : "text-muted-foreground hover:text-foreground"}`}>
              Last {d} days
            </a>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Stat label="Spent" value={money(spend)} />
          <Stat label="Leads (Meta)" value={String(leadsMeta)} sub={leadsMeta ? `${money(spend / leadsMeta)} per lead` : undefined} />
          <Stat label="Booked appointments" value={String(periodLeads.filter((l) => l.appointment).length)} sub={`from ${periodLeads.length} leads in the CRM`} />
          <Stat label="Reached by phone" value={contact.rate == null ? "—" : `${Math.round(contact.rate * 100)}%`}
            sub={`${contact.not_yet_attempted} not called yet${data.contactTrackingMature ? "" : " · tracking is new"}`} />
        </div>

        {/* ── Campaigns ───────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Campaigns</CardTitle></CardHeader>
          <CardContent className="px-2 sm:px-6"><CampaignTable campaigns={campaigns} /></CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Last 30 days</CardTitle></CardHeader>
            <CardContent><TrendChart data={trend} /></CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Calls on ad leads</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row label="Reached" value={`${contact.reached} of ${contact.eligible}`} />
              <Row label={`Not reached after ${data.settings.min_call_attempts}+ calls`} value={String(contact.not_reached_after_attempts)} />
              <Row label={`Called fewer than ${data.settings.min_call_attempts} times`} value={String(contact.under_attempted)} />
              <Row label="Not called yet (team follow-up)" value={String(contact.not_yet_attempted)} strong={contact.not_yet_attempted > 0} />
              <p className="text-xs text-muted-foreground pt-1">
                {data.contactTrackingMature
                  ? "Every call is logged (CRM buttons, Lia and the Quo app)."
                  : `Call logging started ${data.trackingSince ? new Date(data.trackingSince).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "today"}. Until it has 14 days of history, contact rate is shown for information only and never used to judge an ad.`}
                {contact.estimated > 0 && ` ${contact.estimated} older lead${contact.estimated === 1 ? "'s" : "s'"} call counts are estimated.`}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Regions ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">By area (last 30 days)</CardTitle></CardHeader>
          <CardContent>
            {!regions.length ? <p className="text-sm text-muted-foreground">No leads in the last 30 days.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-xs text-muted-foreground border-b">
                    <th className="py-2 pr-3 text-left font-medium">Area</th>
                    <th className="py-2 px-3 text-right font-medium">Leads</th>
                    <th className="py-2 px-3 text-right font-medium">Appointments</th>
                    <th className="py-2 px-3 text-right font-medium">Sold</th>
                    <th className="py-2 px-3 text-right font-medium">Per appointment</th>
                    <th className="py-2 pl-3 text-right font-medium">Per sale</th>
                  </tr></thead>
                  <tbody>
                    {regions.map((g) => (
                      <tr key={g.region} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{g.region}</span>
                          <span className="block text-xs text-muted-foreground">
                            {Object.entries(g.cities).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(", ")}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">{g.leads}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{g.appointments}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{g.sales}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{g.cost_per_appointment.status === "ok" ? money(g.cost_per_appointment.value) : <span className="text-muted-foreground">{g.cost_per_appointment.status === "too_early" ? "too early" : "none yet"}</span>}</td>
                        <td className="py-2 pl-3 text-right tabular-nums">{g.cost_per_sale.status === "ok" ? money(g.cost_per_sale.value) : <span className="text-muted-foreground">{g.cost_per_sale.status === "too_early" ? "too early" : "none yet"}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-muted-foreground mt-2">Spend is split by each area&apos;s share of leads.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Reports ─────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Reports</CardTitle></CardHeader>
          <CardContent><ReportHistory reports={(reports ?? []) as ReportRow[]} /></CardContent>
        </Card>

        {/* ── Settings ────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Targets and alerts</CardTitle></CardHeader>
          <CardContent><SettingsForm settings={data.settings} /></CardContent>
        </Card>

        {/* ── Setup ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Setup</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="font-medium">1. Connect Meta (read-only)</p>
              <ol className="list-decimal pl-5 mt-1 space-y-1 text-muted-foreground">
                <li>Meta Business Settings → Users → System users → Add: name it &quot;Omdan CRM&quot;, role Employee.</li>
                <li>Assign assets: your <strong>ad account</strong> (View performance) <strong>and your Facebook Page</strong>. The Page is required to read lead details.</li>
                <li>Generate token: pick your app, expiry &quot;Never&quot;, permissions <code>ads_read</code>, <code>leads_retrieval</code>, <code>pages_show_list</code>, <code>pages_read_engagement</code>.</li>
                <li>In Vercel → Settings → Environment Variables add <code>META_ACCESS_TOKEN</code> (the token) and <code>META_AD_ACCOUNT_ID</code> (the number after act_ in Ads Manager), then redeploy.</li>
              </ol>
            </div>
            <div>
              <p className="font-medium">2. Add these URL parameters to every ad</p>
              <p className="text-muted-foreground mt-1">Ads Manager → ad → Tracking → URL parameters. This ties website bookings to the exact ad.</p>
              <div className="mt-2"><CopyText text={AD_URL_PARAMETERS} /></div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Banner({ tone, title, children }: { tone: "info" | "warn" | "danger"; title: string; children: React.ReactNode }) {
  const cls = tone === "danger" ? "border-destructive/40 bg-destructive/5" : tone === "warn" ? "border-warning/40 bg-warning/5" : "border-border bg-muted/40"
  const Icon = tone === "info" ? Info : AlertTriangle
  return (
    <div className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${tone === "danger" ? "text-destructive" : tone === "warn" ? "text-warning" : "text-muted-foreground"}`} />
      <div><p className="font-medium">{title}</p><p className="text-muted-foreground mt-0.5">{children}</p></div>
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={strong ? "font-semibold text-warning" : "font-medium tabular-nums"}>{value}</span>
    </div>
  )
}
