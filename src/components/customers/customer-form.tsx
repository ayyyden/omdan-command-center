"use client"

import { useState, useEffect } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { customerSchema, type CustomerFormValues } from "@/lib/validations/customer"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AddressAutocomplete } from "@/components/ui/address-autocomplete"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { CalendarDays, Clock, Loader2, Plus, Trash2, UserCircle } from "lucide-react"
import type { Customer } from "@/types"

const LEAD_STATUSES = [
  "New Lead","Contacted","Estimate Sent","Follow-Up Needed",
  "Approved","Scheduled","In Progress","Completed","Paid","Closed Lost",
] as const

interface LeadSource { value: string; label: string; is_default: boolean }

interface PropStreamPrefill {
  name?:        string
  phone?:       string
  email?:       string
  address?:     string
  notes?:       string
  lead_source?: string
}

interface PmOption { id: string; name: string; color: string }

interface CustomerFormProps {
  customer?:           Customer
  userId:              string
  prefill?:            PropStreamPrefill
  propstreamLeadId?:   string
  propstreamPhoneId?:  string
  returnTo?:           string
  pms?:                PmOption[]
}

export function CustomerForm({ customer, userId, prefill, propstreamLeadId, propstreamPhoneId, returnTo, pms = [] }: CustomerFormProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [sources, setSources] = useState<LeadSource[]>([])
  const [manageOpen, setManageOpen] = useState(false)
  const [newSourceLabel, setNewSourceLabel] = useState("")
  const [addingSource, setAddingSource] = useState(false)
  const [deletingSource, setDeletingSource] = useState<string | null>(null)

  // Appointment scheduling (new leads only)
  const [apptDate, setApptDate] = useState("")
  const [apptStartTime, setApptStartTime] = useState("")
  const [apptEndTime, setApptEndTime] = useState("")
  const [apptPmId, setApptPmId] = useState("")

  useEffect(() => {
    fetch("/api/lead-sources")
      .then((r) => r.json())
      .then((data: LeadSource[]) => Array.isArray(data) && setSources(data))
      .catch(() => {})
  }, [])

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name:         customer?.name        ?? prefill?.name        ?? "",
      phone:        customer?.phone       ?? prefill?.phone       ?? "",
      email:        customer?.email       ?? prefill?.email       ?? "",
      address:      customer?.address     ?? prefill?.address     ?? "",
      service_type: customer?.service_type ?? "",
      lead_source:  customer?.lead_source ?? prefill?.lead_source ?? undefined,
      status:       customer?.status      ?? "New Lead",
      notes:        customer?.notes       ?? prefill?.notes       ?? "",
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    const supabase = createClient()
    const payload = { ...values, user_id: userId }

    let error
    let insertedId: string | undefined

    if (customer) {
      ;({ error } = await supabase.from("customers").update(payload).eq("id", customer.id))
      insertedId = customer.id
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("customers")
        .insert(payload)
        .select("id")
        .single()
      error = insertError
      insertedId = inserted?.id
    }

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }

    if (!customer && insertedId) {
      await supabase.from("activity_log").insert({
        user_id:     userId,
        entity_type: "customer",
        entity_id:   insertedId,
        action:      "created",
        description: `New lead added: ${values.name}`,
      })

      // If this came from the PropStream work flow, mark the PropStream lead as converted
      if (propstreamLeadId) {
        await fetch(`/api/propstream/leads/${propstreamLeadId}/convert`, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ customer_id: insertedId }),
        }).catch(() => {})  // non-fatal — CRM lead is already created
      }

      // Schedule appointment if date was provided (non-blocking)
      if (apptDate) {
        await fetch("/api/lead-appointments", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            customer_id:     insertedId,
            scheduled_date:  apptDate,
            start_time:      apptStartTime || null,
            end_time:        apptEndTime   || null,
            assigned_pm_id:  apptPmId      || null,
            project_summary: values.service_type || null,
          }),
        }).catch(() => {})
      }
    }

    toast({ title: customer ? "Customer updated" : "Lead added", description: values.name })
    router.push(returnTo ?? "/customers")
    router.refresh()
  }

  async function handleAddSource() {
    if (!newSourceLabel.trim()) return
    setAddingSource(true)
    try {
      const res = await fetch("/api/lead-sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newSourceLabel.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" })
        return
      }
      setSources((prev) => [...prev, data as LeadSource])
      form.setValue("lead_source", data.value)
      setNewSourceLabel("")
      toast({ title: "Lead source added" })
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setAddingSource(false)
    }
  }

  async function handleDeleteSource(value: string) {
    setDeletingSource(value)
    try {
      const res = await fetch("/api/lead-sources", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Error", description: data.error, variant: "destructive" })
        return
      }
      setSources((prev) => prev.filter((s) => s.value !== value))
      if (form.getValues("lead_source") === value) {
        form.setValue("lead_source", undefined as any)
      }
      toast({
        title: "Lead source removed",
        description: data.archived
          ? `Archived — ${data.affected} existing lead${data.affected !== 1 ? "s" : ""} unchanged`
          : "Deleted",
      })
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setDeletingSource(null)
    }
  }

  const customSources = sources.filter((s) => !s.is_default)

  return (
    <>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Card>
            <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Full Name *</FormLabel>
                  <FormControl><Input placeholder="John Smith" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="(555) 000-0000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input placeholder="john@example.com" type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <AddressAutocomplete placeholder="123 Main St, City, State 00000" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="service_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Service Type</FormLabel>
                  <FormControl><Input placeholder="Kitchen Remodel, Bathroom, Deck..." {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Lead Source */}
              <FormField control={form.control} name="lead_source" render={({ field }) => (
                <FormItem>
                  <FormLabel>Lead Source</FormLabel>
                  <div className="flex gap-2">
                    <Select onValueChange={field.onChange} value={field.value ?? ""}>
                      <FormControl>
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder="Where did they come from?" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {sources.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setManageOpen(true)}
                      title="Manage lead sources"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              {/* Status: only shown when editing */}
              {customer && (
                <FormField control={form.control} name="status" render={({ field }) => (
                  <FormItem className="sm:col-span-2">
                    <FormLabel>Status</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {LEAD_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Project details, special instructions, anything relevant..."
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </CardContent>
          </Card>

          {/* Schedule Appointment — new leads only */}
          {!customer && (
            <Card>
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-center gap-2 mb-1">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-semibold">Schedule Appointment</span>
                  <span className="text-xs text-muted-foreground ml-1">(optional)</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="sm:col-span-1">
                    <label className="text-sm font-medium mb-1.5 block">Date</label>
                    <Input
                      type="date"
                      value={apptDate}
                      onChange={(e) => setApptDate(e.target.value)}
                      className="dark:[color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" /> Start Time
                    </label>
                    <Input
                      type="time"
                      value={apptStartTime}
                      onChange={(e) => setApptStartTime(e.target.value)}
                      disabled={!apptDate}
                      className="dark:[color-scheme:dark]"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium mb-1.5 block">End Time</label>
                    <Input
                      type="time"
                      value={apptEndTime}
                      onChange={(e) => setApptEndTime(e.target.value)}
                      disabled={!apptDate}
                      className="dark:[color-scheme:dark]"
                    />
                  </div>
                </div>

                {pms.length > 0 && (
                  <div>
                    <label className="text-sm font-medium mb-1.5 block flex items-center gap-1">
                      <UserCircle className="w-3.5 h-3.5" /> Assign PM
                    </label>
                    <Select value={apptPmId} onValueChange={setApptPmId} disabled={!apptDate}>
                      <SelectTrigger className="w-full sm:w-64">
                        <SelectValue placeholder="No PM assigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No PM assigned</SelectItem>
                        {pms.map((pm) => (
                          <SelectItem key={pm.id} value={pm.id}>
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                              {pm.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {customer ? "Save Changes" : "Add Lead"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          </div>
        </form>
      </Form>

      {/* Manage lead sources dialog */}
      <Dialog open={manageOpen} onOpenChange={(o) => { setManageOpen(o); if (!o) setNewSourceLabel("") }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Lead Sources</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-1">
            {/* Custom sources with delete */}
            {customSources.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Custom Sources</p>
                <div className="rounded-lg border divide-y">
                  {customSources.map((s) => (
                    <div key={s.value} className="flex items-center justify-between px-3 py-2">
                      <span className="text-sm">{s.label}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                        onClick={() => handleDeleteSource(s.value)}
                        disabled={deletingSource === s.value}
                        title="Remove this lead source"
                      >
                        {deletingSource === s.value
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          : <Trash2 className="w-3.5 h-3.5" />}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Add new source */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Add Source</p>
              <Input
                placeholder="e.g. Home Advisor, Trade Show..."
                value={newSourceLabel}
                onChange={(e) => setNewSourceLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddSource() } }}
                autoFocus
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setManageOpen(false)} disabled={addingSource}>
              Close
            </Button>
            <Button onClick={handleAddSource} disabled={addingSource || !newSourceLabel.trim()}>
              {addingSource && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Add Source
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
