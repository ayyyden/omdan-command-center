"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import { Search, Briefcase, User } from "lucide-react"

interface JobOption {
  id: string
  title: string
  customer_id: string
  customer_name: string
  customer_email: string | null
}

interface CustomerOption {
  id: string
  name: string
  email: string | null
}

export interface RecipientSelection {
  customerId:     string
  jobId:          string | null
  recipientEmail: string
}

interface Props {
  userId: string
  onChange: (selection: RecipientSelection | null) => void
}

type Mode = "job" | "customer"

// Reused by both the Send and Sign Now flows: pick a Job or a Customer/Lead
// to attach the document to, then confirm/override the email it goes to
// (defaults to the email on file — most of the time a job is only created
// after a lead is sold, so Customer/Lead is the more common pick pre-sale).
export function RecipientPicker({ userId, onChange }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [mode, setMode] = useState<Mode>("customer")
  const [query, setQuery] = useState("")
  const [jobs, setJobs] = useState<JobOption[]>([])
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedJob, setSelectedJob] = useState<JobOption | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null)
  const [email, setEmail] = useState("")

  useEffect(() => {
    setLoading(true)
    const timeout = setTimeout(async () => {
      if (mode === "job") {
        let q = supabase
          .from("jobs")
          .select("id, title, customer_id, customer:customers(name, email)")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(25)
        if (query.trim()) q = q.ilike("title", `%${query.trim()}%`)
        const { data } = await q
        setJobs((data ?? []).map((j: any) => ({
          id: j.id, title: j.title, customer_id: j.customer_id,
          customer_name: j.customer?.name ?? "—", customer_email: j.customer?.email ?? null,
        })))
      } else {
        let q = supabase
          .from("customers")
          .select("id, name, email")
          .eq("user_id", userId)
          .eq("is_archived", false)
          .order("name")
          .limit(25)
        if (query.trim()) q = q.ilike("name", `%${query.trim()}%`)
        const { data } = await q
        setCustomers((data ?? []) as CustomerOption[])
      }
      setLoading(false)
    }, 250)
    return () => clearTimeout(timeout)
  }, [mode, query, userId, supabase])

  function pickJob(j: JobOption) {
    setSelectedJob(j)
    setSelectedCustomer(null)
    setEmail(j.customer_email ?? "")
  }

  function pickCustomer(c: CustomerOption) {
    setSelectedCustomer(c)
    setSelectedJob(null)
    setEmail(c.email ?? "")
  }

  useEffect(() => {
    if (selectedJob) {
      onChange(email.trim() ? { customerId: selectedJob.customer_id, jobId: selectedJob.id, recipientEmail: email.trim() } : null)
    } else if (selectedCustomer) {
      onChange(email.trim() ? { customerId: selectedCustomer.id, jobId: null, recipientEmail: email.trim() } : null)
    } else {
      onChange(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedJob, selectedCustomer, email])

  function switchMode(m: Mode) {
    setMode(m)
    setQuery("")
    setSelectedJob(null)
    setSelectedCustomer(null)
    setEmail("")
  }

  const selected = selectedJob ?? selectedCustomer

  return (
    <div className="space-y-3">
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          type="button"
          onClick={() => switchMode("customer")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
            mode === "customer" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <User className="w-3.5 h-3.5" /> Customer / Lead
        </button>
        <button
          type="button"
          onClick={() => switchMode("job")}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-sm font-medium rounded-md transition-colors ${
            mode === "job" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Briefcase className="w-3.5 h-3.5" /> Job
        </button>
      </div>

      {!selected ? (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === "job" ? "Search jobs by address…" : "Search customers by name…"}
              className="pl-8"
            />
          </div>
          <div className="rounded-lg border divide-y max-h-64 overflow-y-auto">
            {loading && <p className="px-3 py-3 text-sm text-muted-foreground">Searching…</p>}
            {!loading && mode === "job" && jobs.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => pickJob(j)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm font-medium truncate">{j.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">{j.customer_name}</span>
              </button>
            ))}
            {!loading && mode === "customer" && customers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickCustomer(c)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="text-sm font-medium truncate">{c.name}</span>
                <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[45%]">{c.email ?? "No email"}</span>
              </button>
            ))}
            {!loading && ((mode === "job" && jobs.length === 0) || (mode === "customer" && customers.length === 0)) && (
              <p className="px-3 py-3 text-sm text-muted-foreground">No results.</p>
            )}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">
                {selectedJob ? selectedJob.title : selectedCustomer!.name}
              </p>
              {selectedJob && <p className="text-xs text-muted-foreground truncate">{selectedJob.customer_name}</p>}
            </div>
            <button
              type="button"
              onClick={() => { setSelectedJob(null); setSelectedCustomer(null); setEmail("") }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground shrink-0"
            >
              Change
            </button>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Send to (edit if needed)
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="customer@example.com"
            />
            {!email && <p className="text-xs text-warning">No email on file — enter one above.</p>}
          </div>
        </div>
      )}
    </div>
  )
}
