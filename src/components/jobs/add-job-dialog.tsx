"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Loader2, Plus } from "lucide-react"
import { ServiceTypeMultiSelect } from "@/components/ui/service-type-multi-select"

interface PmInfo { id: string; name: string; color: string }

interface Props {
  userId: string
  pms: PmInfo[]
}

export function AddJobDialog({ userId, pms }: Props) {
  const [open, setOpen]               = useState(false)
  const [submitting, setSubmitting]   = useState(false)
  const [sources, setSources]         = useState<{ value: string; label: string }[]>([])

  // Customer fields
  const [name, setName]               = useState("")
  const [phone, setPhone]             = useState("")
  const [email, setEmail]             = useState("")
  const [leadSource, setLeadSource]   = useState("")

  // Job fields
  const [serviceType, setServiceType] = useState("")
  const [pmId, setPmId]               = useState("")
  const [scheduledDate, setScheduledDate] = useState("")
  const [notes, setNotes]             = useState("")

  const router  = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    if (!open) return
    fetch("/api/lead-sources")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setSources(d))
      .catch(() => {})
  }, [open])

  function reset() {
    setName(""); setPhone(""); setEmail(""); setLeadSource("")
    setServiceType(""); setPmId(""); setScheduledDate(""); setNotes("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      toast({ title: "Full name is required", variant: "destructive" }); return
    }

    const resolvedService = serviceType.trim()

    setSubmitting(true)
    const supabase = createClient()

    // 1 — create customer
    const { data: customer, error: custErr } = await supabase
      .from("customers")
      .insert({
        user_id:      userId,
        name:         name.trim(),
        phone:        phone.trim() || null,
        email:        email.trim() || null,
        service_type: resolvedService || null,
        lead_source:  leadSource || null,
        status:       "Scheduled",
      })
      .select("id")
      .single()

    if (custErr || !customer) {
      toast({ title: "Error creating customer", description: custErr?.message, variant: "destructive" })
      setSubmitting(false); return
    }

    // 2 — create job
    const jobTitle = resolvedService || name.trim()
    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id:                   userId,
        customer_id:               customer.id,
        title:                     jobTitle,
        status:                    scheduledDate ? "scheduled" : "in_progress",
        project_manager_id:        (pmId && pmId !== "none") ? pmId : null,
        scheduled_date:            scheduledDate || null,
        notes:                     notes.trim() || null,
        estimated_duration_minutes: 120,
      })
      .select("id")
      .single()

    if (jobErr || !job) {
      toast({ title: "Error creating job", description: jobErr?.message, variant: "destructive" })
      setSubmitting(false); return
    }

    // 3 — activity log
    await supabase.from("activity_log").insert([
      {
        user_id: userId, entity_type: "customer", entity_id: customer.id,
        action: "created", description: `New customer added: ${name.trim()}`,
      },
      {
        user_id: userId, entity_type: "job", entity_id: job.id,
        action: "created", description: `Job created: ${jobTitle}`,
        job_id: job.id,
      },
    ])

    toast({ title: "Job added", description: `${jobTitle} for ${name.trim()}` })
    setOpen(false)
    reset()
    router.push(`/jobs/${job.id}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="w-4 h-4 mr-1" /> Add Job
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Job</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-1">
          {/* ── Customer info ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer</p>

            <div className="space-y-1.5">
              <Label htmlFor="aj-name">Full Name *</Label>
              <Input id="aj-name" placeholder="John Smith" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="aj-phone">Phone</Label>
                <Input id="aj-phone" placeholder="(555) 000-0000" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="aj-email">Email</Label>
                <Input id="aj-email" type="email" placeholder="john@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Lead Source</Label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger>
                  <SelectValue placeholder="Where did they come from?" />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Job info ── */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Job</p>

            <div className="space-y-1.5">
              <Label>Service Type</Label>
              <ServiceTypeMultiSelect value={serviceType} onChange={setServiceType} />
            </div>

            {pms.length > 0 && (
              <div className="space-y-1.5">
                <Label>Project Manager</Label>
                <Select value={pmId} onValueChange={setPmId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {pms.map((pm) => (
                      <SelectItem key={pm.id} value={pm.id}>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                          {pm.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="aj-date">Scheduled Date</Label>
              <Input
                id="aj-date"
                type="date"
                value={scheduledDate}
                onChange={(e) => setScheduledDate(e.target.value)}
                className="dark:[color-scheme:dark]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="aj-notes">Notes</Label>
              <Textarea
                id="aj-notes"
                placeholder="Project details, special instructions…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1 border-t">
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Job
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
