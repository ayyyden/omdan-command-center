"use client"

import { useState, useEffect, useCallback, useTransition } from "react"
import { Button }   from "@/components/ui/button"
import { Input }    from "@/components/ui/input"
import { Badge }    from "@/components/ui/badge"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  Phone, MessageSquare, Search, RefreshCw, ChevronLeft, ChevronRight,
} from "lucide-react"
import { CallWorkspace } from "./call-workspace"
import { SmsModal }      from "./sms-modal"

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadPhone {
  id:              string
  phone:           string
  phone_type:      string | null
  is_active:       boolean
  is_wrong_number: boolean
  position:        number
}

interface Lead {
  id:               string
  list_id:          string
  owner_name:       string | null
  owner2_name:      string | null
  property_address: string | null
  property_city:    string | null
  property_state:   string | null
  property_zip:     string | null
  status:           string
  estimated_value:  number | null
  estimated_equity: number | null
  last_called_at:   string | null
  next_follow_up_at: string | null
  emails:           string[]
  propstream_lead_phones: LeadPhone[]
}

interface PropStreamList {
  id:             string
  name:           string
  imported_count: number
  callable_count: number
}

interface Props {
  lists:         PropStreamList[]
  canCall:       boolean
  defaultStatus?: string
}

// ─── Status config ─────────────────────────────────────────────────────────────

const ALL_STATUSES = [
  { value: "",                label: "All statuses" },
  { value: "new",             label: "New" },
  { value: "called_no_answer",label: "No Answer" },
  { value: "callback_later",  label: "Call Back Later" },
  { value: "not_interested",  label: "Not Interested" },
  { value: "warm_lead",       label: "Warm Lead" },
  { value: "approved",        label: "Approved" },
  { value: "converted",       label: "Converted" },
  { value: "do_not_call",     label: "Do Not Call" },
  { value: "wrong_number",    label: "Wrong Number" },
  { value: "no_callable_phone", label: "No Phone" },
]

const STATUS_BADGE: Record<string, string> = {
  new:               "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  called_no_answer:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  callback_later:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  not_interested:    "bg-gray-100 text-gray-600 dark:bg-gray-800/60 dark:text-gray-400",
  warm_lead:         "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  approved:          "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  converted:         "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300",
  do_not_call:       "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  wrong_number:      "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  no_callable_phone: "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-500",
}

const STATUS_LABEL: Record<string, string> = {
  new:               "New",
  called_no_answer:  "No Answer",
  callback_later:    "Call Back",
  not_interested:    "Not Interested",
  warm_lead:         "Warm Lead",
  approved:          "Approved",
  converted:         "Converted",
  do_not_call:       "DNC",
  wrong_number:      "Wrong #",
  no_callable_phone: "No Phone",
}

// ─── Component ─────────────────────────────────────────────────────────────────

const LIMIT = 50

export function LeadsDashboard({ lists, canCall, defaultStatus = "" }: Props) {
  const [leads,    setLeads]    = useState<Lead[]>([])
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [loading,  setLoading]  = useState(false)
  const [isPending, startTransition] = useTransition()

  const [listId,  setListId]  = useState<string>("")
  const [status,  setStatus]  = useState<string>(defaultStatus)
  const [search,  setSearch]  = useState<string>("")
  const [debouncedSearch, setDebouncedSearch] = useState<string>("")

  const [workspaceLead, setWorkspaceLead]   = useState<Lead | null>(null)
  const [smsLead,       setSmsLead]         = useState<Lead | null>(null)
  const [smsPhoneId,    setSmsPhoneId]      = useState<string>("")
  const [smsPhone,      setSmsPhone]        = useState<string>("")

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350)
    return () => clearTimeout(t)
  }, [search])

  const fetchLeads = useCallback(async (p: number) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) })
    if (listId)          params.set("list_id", listId)
    if (status)          params.set("status", status)
    if (debouncedSearch) params.set("search", debouncedSearch)

    const res  = await fetch(`/api/propstream/leads?${params}`)
    const data = await res.json()
    setLoading(false)
    if (res.ok) {
      setLeads(data.leads)
      setTotal(data.total)
    }
  }, [listId, status, debouncedSearch])

  useEffect(() => {
    setPage(1)
    fetchLeads(1)
  }, [fetchLeads])

  function handleOutcome(leadId: string, newStatus: string) {
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, status: newStatus } : l))
  }

  function openSms(lead: Lead) {
    const phone = lead.propstream_lead_phones.find((p) => p.is_active && !p.is_wrong_number)
    if (!phone) return
    setSmsLead(lead)
    setSmsPhoneId(phone.id)
    setSmsPhone(phone.phone)
  }

  const formatCurrency = (n: number | null) =>
    n == null ? "—" : `$${(n / 1000).toFixed(0)}k`

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={listId || "__all__"} onValueChange={(v) => setListId(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All lists" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All lists</SelectItem>
            {lists.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
                <span className="ml-2 text-xs text-muted-foreground">({l.callable_count} callable)</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={status || "__all__"} onValueChange={(v) => setStatus(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {ALL_STATUSES.map((s) => (
              <SelectItem key={s.value || "__all__"} value={s.value || "__all__"}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Button
          variant="ghost" size="icon"
          onClick={() => fetchLeads(page)}
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>

        <span className="text-sm text-muted-foreground ml-auto">
          {total.toLocaleString()} leads
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto rounded-lg border">
        <table className="w-full text-sm min-w-[700px]">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Owner</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Address</th>
              <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Value</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground">Equity</th>
              <th className="text-right px-3 py-2 font-medium text-muted-foreground w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading && leads.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground">Loading…</td>
              </tr>
            )}
            {!loading && leads.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-12 text-muted-foreground">No leads match your filters</td>
              </tr>
            )}
            {leads.map((lead) => {
              const hasPhone = lead.propstream_lead_phones.some((p) => p.is_active && !p.is_wrong_number)
              return (
                <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2.5">
                    <div className="font-medium">{lead.owner_name ?? "—"}</div>
                    {lead.owner2_name && (
                      <div className="text-xs text-muted-foreground">{lead.owner2_name}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground text-xs">
                    <div>{lead.property_address ?? "—"}</div>
                    {lead.property_city && (
                      <div>{lead.property_city}{lead.property_state ? `, ${lead.property_state}` : ""} {lead.property_zip ?? ""}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[lead.status] ?? ""}`}>
                      {STATUS_LABEL[lead.status] ?? lead.status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">{formatCurrency(lead.estimated_value)}</td>
                  <td className="px-3 py-2.5 text-right">{formatCurrency(lead.estimated_equity)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      {canCall && hasPhone && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-7 h-7"
                          title="Call"
                          onClick={() => setWorkspaceLead(lead)}
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      {canCall && hasPhone && (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="w-7 h-7"
                          title="Send SMS"
                          onClick={() => openSms(lead)}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <Button
            variant="outline" size="sm"
            disabled={page <= 1 || loading}
            onClick={() => { const p = page - 1; setPage(p); fetchLeads(p) }}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            Prev
          </Button>
          <span className="text-muted-foreground">Page {page} of {totalPages}</span>
          <Button
            variant="outline" size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => { const p = page + 1; setPage(p); fetchLeads(p) }}
          >
            Next
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Call workspace modal */}
      {workspaceLead && (
        <CallWorkspace
          open={!!workspaceLead}
          onClose={() => setWorkspaceLead(null)}
          lead={workspaceLead}
          onOutcome={handleOutcome}
        />
      )}

      {/* Manual SMS modal */}
      {smsLead && (
        <SmsModal
          open={!!smsLead}
          onClose={() => { setSmsLead(null); setSmsPhoneId(""); setSmsPhone("") }}
          leadId={smsLead.id}
          phoneId={smsPhoneId}
          toPhone={smsPhone}
          ownerName={smsLead.owner_name ?? "Lead"}
        />
      )}
    </div>
  )
}
