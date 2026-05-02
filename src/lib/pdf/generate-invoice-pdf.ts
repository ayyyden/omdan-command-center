// Server-side invoice PDF buffer generator.
// Uses the service client (no user session required).
// Called from both the manual invoice send route and the assistant execute route.

import { renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import { InvoicePDFDocument } from "./invoice-document"
import { createServiceClient } from "@/lib/supabase/service"

export interface GenerateInvoicePDFInput {
  invoice: {
    id: string
    invoice_number: string | null
    created_at: string
    type: string
    type_label: string
    amount: number
    due_date: string | null
    notes: string | null
    payment_methods: string[]
  }
  customer: {
    name: string
    address?: string | null
    phone?: string | null
    email?: string | null
  }
  job: { title: string | null } | null
  ownerUserId: string
}

export async function generateInvoicePDFBuffer(
  input: GenerateInvoicePDFInput,
): Promise<Buffer> {
  const supabase = createServiceClient()

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, license_number, logo_url, address")
    .eq("user_id", input.ownerUserId)
    .maybeSingle()

  // Convert logo URL to base64 data URL so @react-pdf/renderer can render it
  let logoDataUrl: string | null = null
  if (company?.logo_url) {
    try {
      const res = await fetch(company.logo_url, { signal: AbortSignal.timeout(4000) })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const ct  = res.headers.get("content-type") ?? "image/png"
        logoDataUrl = `data:${ct};base64,${Buffer.from(buf).toString("base64")}`
      }
    } catch { /* fall through — initials placeholder used */ }
  }

  const doc = React.createElement(InvoicePDFDocument, {
    invoice: input.invoice,
    customer: {
      name:    input.customer.name,
      address: input.customer.address ?? null,
      phone:   input.customer.phone   ?? null,
      email:   input.customer.email   ?? null,
    },
    job: input.job,
    company: {
      company_name:   company?.company_name   ?? null,
      phone:          company?.phone          ?? null,
      email:          company?.email          ?? null,
      license_number: company?.license_number ?? null,
      logo_url:       logoDataUrl,
      address:        company?.address        ?? null,
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(doc as React.ReactElement<any>)
}
