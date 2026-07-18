"use client"

import { useState } from "react"
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
import { Loader2, Briefcase } from "lucide-react"

const SERVICE_TYPE_PRESETS = [
  "Artificial Grass", "Pavers", "Concrete", "Bathroom", "Roof",
  "Windows", "Gutters", "Gravel", "DG", "White Rocks", "Paint",
  "Refinish", "Kitchen",
] as const

function isPreset(v: string) {
  return SERVICE_TYPE_PRESETS.includes(v as (typeof SERVICE_TYPE_PRESETS)[number])
}

interface PmInfo { id: string; name: string; color: string }

interface Props {
  customerId:   string
  customerName: string
  serviceType:  string | null
  userId:       string
  pms:          PmInfo[]
}

export function CreateJobDialog({ customerId, customerName, serviceType, userId, pms }: Props) {
  const initial = serviceType ?? ""
  const [open, setOpen]           = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [selectedService, setSelectedService] = useState(
    initial && isPreset(initial) ? initial : initial ? "__other__" : ""
  )
  const [customService, setCustomService] = useState(
    initial && !isPreset(initial) ? initial : ""
  )
  const [pmId, setPmId]               = useState("")
  const [scheduledDate, setScheduledDate] = useState("")
  const [notes, setNotes]             = useState("")

  const router    = useRouter()
  const { toast } = useToast()

  function reset() {
    setSelectedService(initial && isPreset(initial) ? initial : initial ? "__other__" : "")
    setCustomService(initial && !isPreset(initial) ? initial : "")
    setPmId(""); setScheduledDate(""); setNotes("")
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const resolvedService = selectedService === "__other__"
      ? customService.trim()
      : selectedService

    if (!resolvedService) {
      toast({ title: "Service type is required", variant: "destructive" }); return
    }

    setSubmitting(true)
    const supabase = createClient()

    const { data: job, error: jobErr } = await supabase
      .from("jobs")
      .insert({
        user_id:                    userId,
        customer_id:                customerId,
        title:                      resolvedService,
        status:                     scheduledDate ? "scheduled" : "in_progress",
        project_manager_id:         (pmId && pmId !== "none") ? pmId : null,
        scheduled_date:             scheduledDate || null,
        notes:                      notes.trim() || null,
        estimated_duration_minutes: 120,
      })
      .select("id")
      .single()

    if (jobErr || !job) {
      toast({ title: "Error creating job", description: jobErr?.message, variant: "destructive" })
      setSubmitting(false); return
    }

    // Update customer status to Scheduled
    await supabase
      .from("customers")
      .update({ status: "Scheduled" })
      .eq("id", customerId)

    await supabase.from("activity_log").insert({
      user_id:     userId,
      entity_type: "job",
      entity_id:   job.id,
      action:      "created",
      description: `Job created from lead: ${resolvedService}`,
      job_id:      job.id,
    })

    toast({ title: "Job created", description: `${resolvedService} for ${customerName}` })
    setOpen(false)
    reset()
    router.push(`/jobs/${job.id}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Briefcase className="w-3 h-3 mr-1" /> Create Job
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Job for {customerName}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label>Service Type *</Label>
            <Select
              value={selectedService}
              onValueChange={(v) => {
                setSelectedService(v)
                if (v !== "__other__") setCustomService("")
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select service type…" />
              </SelectTrigger>
              <SelectContent>
                {SERVICE_TYPE_PRESETS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
                <SelectItem value="__other__">Other (type your own)</SelectItem>
              </SelectContent>
            </Select>
            {selectedService === "__other__" && (
              <Input
                placeholder="e.g. Pool, Driveway, Deck…"
                value={customService}
                onChange={(e) => setCustomService(e.target.value)}
                className="mt-2"
              />
            )}
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
            <Label htmlFor="cj-date">Scheduled Date</Label>
            <Input
              id="cj-date"
              type="date"
              value={scheduledDate}
              onChange={(e) => setScheduledDate(e.target.value)}
              className="dark:[color-scheme:dark]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cj-notes">Notes</Label>
            <Textarea
              id="cj-notes"
              placeholder="Project details, special instructions…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="min-h-[80px]"
            />
          </div>

          <div className="flex gap-3 pt-1 border-t">
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Job
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
