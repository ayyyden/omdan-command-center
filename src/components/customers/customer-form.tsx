"use client"

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
import { Loader2 } from "lucide-react"
import type { Customer } from "@/types"

const LEAD_STATUSES = [
  "New Lead","Contacted","Estimate Sent","Follow-Up Needed",
  "Approved","Scheduled","In Progress","Completed","Paid","Closed Lost",
] as const

const LEAD_SOURCES = [
  { value: "referral", label: "Referral" },
  { value: "google", label: "Google" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "door_knock", label: "Door Knock" },
  { value: "repeat_customer", label: "Repeat Customer" },
  { value: "yard_sign", label: "Yard Sign" },
  { value: "nextdoor", label: "Nextdoor" },
  { value: "yelp", label: "Yelp" },
  { value: "other", label: "Other" },
]

interface CustomerFormProps {
  customer?: Customer
  userId: string
}

export function CustomerForm({ customer, userId }: CustomerFormProps) {
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: customer?.name ?? "",
      phone: customer?.phone ?? "",
      email: customer?.email ?? "",
      address: customer?.address ?? "",
      service_type: customer?.service_type ?? "",
      lead_source: customer?.lead_source ?? undefined,
      status: customer?.status ?? "New Lead",
      notes: customer?.notes ?? "",
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    const supabase = createClient()
    const payload = { ...values, user_id: userId }

    let error
    if (customer) {
      ;({ error } = await supabase.from("customers").update(payload).eq("id", customer.id))
    } else {
      ;({ error } = await supabase.from("customers").insert(payload))
    }

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }

    // Log activity
    if (!customer) {
      await supabase.from("activity_log").insert({
        user_id: userId,
        entity_type: "customer",
        entity_id: "new",
        action: "created",
        description: `New lead added: ${values.name}`,
      })
    }

    toast({ title: customer ? "Customer updated" : "Lead added", description: values.name })
    router.push("/customers")
    router.refresh()
  }

  return (
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

            <FormField control={form.control} name="lead_source" render={({ field }) => (
              <FormItem>
                <FormLabel>Lead Source</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl><SelectTrigger><SelectValue placeholder="Where did they come from?" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {LEAD_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="status" render={({ field }) => (
              <FormItem>
                <FormLabel>Status *</FormLabel>
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

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {customer ? "Save Changes" : "Add Lead"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        </div>
      </form>
    </Form>
  )
}
