// Server-side PDF buffer generator for the execute/assistant flow.
// Uses the service client (no user session required).
// The dashboard send route has its own inline copy that uses the user session.

import { renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import { EstimatePDFDocument } from "./estimate-document"
import { createServiceClient } from "@/lib/supabase/service"
import type { EstimateLineItem } from "@/types"
import type { EstimatePaymentStep } from "./estimate-document"

export interface GenerateEstimatePDFInput {
  estimate: {
    id: string
    title: string
    created_at: string
    scope_of_work: string | null
    total: number
    notes?: string | null
    payment_steps?: EstimatePaymentStep[]
    approval_link?: string | null
  }
  customer: {
    name: string
    address?: string | null
    phone?: string | null
    email?: string | null
  }
  ownerUserId: string
}

export async function generateEstimatePDFBuffer(
  input: GenerateEstimatePDFInput,
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
        const ct = res.headers.get("content-type") ?? "image/png"
        logoDataUrl = `data:${ct};base64,${Buffer.from(buf).toString("base64")}`
      }
    } catch { /* fall through — initials placeholder used */ }
  }

  const doc = React.createElement(EstimatePDFDocument, {
    estimate: {
      id:             input.estimate.id,
      title:          input.estimate.title,
      created_at:     input.estimate.created_at,
      scope_of_work:  input.estimate.scope_of_work,
      line_items:     [] as EstimateLineItem[],
      subtotal:       input.estimate.total,
      markup_percent: 0,
      markup_amount:  0,
      tax_percent:    0,
      tax_amount:     0,
      total:          input.estimate.total,
      notes:          input.estimate.notes ?? null,
      payment_steps:  input.estimate.payment_steps,
      approval_link:  input.estimate.approval_link,
    },
    customer: {
      name:    input.customer.name,
      address: input.customer.address ?? null,
      phone:   input.customer.phone   ?? null,
      email:   input.customer.email   ?? null,
    },
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
