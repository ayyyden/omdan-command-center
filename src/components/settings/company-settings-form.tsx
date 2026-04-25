"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

const schema = z.object({
  company_name:           z.string().optional(),
  license_number:         z.string().optional(),
  phone:                  z.string().optional(),
  email:                  z.string().email("Invalid email").optional().or(z.literal("")),
  website:                z.string().optional(),
  address:                z.string().optional(),
  logo_url:               z.string().url("Invalid URL").optional().or(z.literal("")),
  google_review_link:     z.string().optional(),
  default_payment_terms:  z.string().optional(),
  default_estimate_notes: z.string().optional(),
  default_invoice_notes:  z.string().optional(),
})

type FormValues = z.infer<typeof schema>

interface CompanySettingsFormProps {
  userId: string
  settings: Partial<FormValues> | null
}

export function CompanySettingsForm({ userId, settings }: CompanySettingsFormProps) {
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name:           settings?.company_name           ?? "",
      license_number:         settings?.license_number         ?? "",
      phone:                  settings?.phone                  ?? "",
      email:                  settings?.email                  ?? "",
      website:                settings?.website                ?? "",
      address:                settings?.address                ?? "",
      logo_url:               settings?.logo_url               ?? "",
      google_review_link:     settings?.google_review_link     ?? "",
      default_payment_terms:  settings?.default_payment_terms  ?? "",
      default_estimate_notes: settings?.default_estimate_notes ?? "",
      default_invoice_notes:  settings?.default_invoice_notes  ?? "",
    },
  })

  async function onSubmit(values: FormValues) {
    const supabase = createClient()
    const { error } = await supabase
      .from("company_settings")
      .upsert(
        {
          user_id:               userId,
          company_name:          values.company_name          || null,
          license_number:        values.license_number        || null,
          phone:                 values.phone                 || null,
          email:                 values.email                 || null,
          website:               values.website               || null,
          address:               values.address               || null,
          logo_url:              values.logo_url              || null,
          google_review_link:    values.google_review_link    || null,
          default_payment_terms: values.default_payment_terms || null,
          default_estimate_notes: values.default_estimate_notes || null,
          default_invoice_notes: values.default_invoice_notes || null,
          updated_at:            new Date().toISOString(),
        },
        { onConflict: "user_id" }
      )

    if (error) {
      toast({ title: "Error saving settings", description: error.message, variant: "destructive" })
      return
    }

    toast({ title: "Settings saved" })
    router.refresh()
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Company Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Company Info</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <FormField control={form.control} name="company_name" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Company Name</FormLabel>
                <FormControl><Input placeholder="Omdan Development Inc." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="license_number" render={({ field }) => (
              <FormItem>
                <FormLabel>License Number</FormLabel>
                <FormControl><Input placeholder="LIC-12345" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="phone" render={({ field }) => (
              <FormItem>
                <FormLabel>Phone</FormLabel>
                <FormControl><Input type="tel" placeholder="(555) 000-0000" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl><Input type="email" placeholder="info@company.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="website" render={({ field }) => (
              <FormItem>
                <FormLabel>Website</FormLabel>
                <FormControl><Input placeholder="https://company.com" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="address" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Address</FormLabel>
                <FormControl><Input placeholder="123 Main St, City, State 00000" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="logo_url" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Logo URL</FormLabel>
                <FormControl><Input placeholder="https://..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="google_review_link" render={({ field }) => (
              <FormItem className="sm:col-span-2">
                <FormLabel>Google Review Link</FormLabel>
                <FormControl><Input placeholder="https://g.page/r/..." {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        {/* Defaults */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Document Defaults</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField control={form.control} name="default_payment_terms" render={({ field }) => (
              <FormItem>
                <FormLabel>Default Payment Terms</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Net 30, 50% deposit required" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="default_estimate_notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Default Estimate Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="e.g. This estimate is valid for 30 days..."
                    className="min-h-[80px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="default_invoice_notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Default Invoice Notes</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="e.g. Thank you for your business. Payment due within 30 days."
                    className="min-h-[80px]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </form>
    </Form>
  )
}
