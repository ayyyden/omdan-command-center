import { NextRequest } from "next/server"
import { renderToBuffer } from "@react-pdf/renderer"
import React from "react"
import { requirePermission, hasJobScope, NO_ROWS_ID } from "@/lib/auth-helpers"
import { EstimatePDFDocument } from "@/lib/pdf/estimate-document"
import type { EstimateLineItem } from "@/types"

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await requirePermission("estimates:view")
  if (session instanceof Response) return session
  const { userId, role, pmId, supabase } = session

  const { data: estimate, error: estErr } = await supabase
    .from("estimates")
    .select("*, customer:customers(name, address, phone, email)")
    .eq("id", id)
    .single()

  if (estErr || !estimate) return Response.json({ error: "Not found" }, { status: 404 })

  // PM scope enforcement
  if (hasJobScope(role)) {
    const { data: ownerJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("estimate_id", id)
      .eq("project_manager_id", pmId ?? NO_ROWS_ID)
      .maybeSingle()
    if (!ownerJob && estimate.user_id !== userId) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, license_number, logo_url, address")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  // Pre-fetch logo and convert to data URL so @react-pdf/renderer can't hit a broken URL
  let logoDataUrl: string | null = null
  if (company?.logo_url) {
    try {
      const res = await fetch(company.logo_url, {
        signal: AbortSignal.timeout(4000),
      })
      if (res.ok) {
        const buf = await res.arrayBuffer()
        const ct = res.headers.get("content-type") ?? "image/png"
        logoDataUrl = `data:${ct};base64,${Buffer.from(buf).toString("base64")}`
      }
    } catch {
      // fall through — initials placeholder will be used
    }
  }

  const customer = estimate.customer as {
    name: string; address: string | null; phone: string | null; email: string | null
  }

  const doc = React.createElement(EstimatePDFDocument, {
    estimate: {
      id:             estimate.id,
      title:          estimate.title,
      created_at:     estimate.created_at,
      scope_of_work:  estimate.scope_of_work,
      line_items:     (estimate.line_items ?? []) as EstimateLineItem[],
      subtotal:       Number(estimate.subtotal),
      markup_percent: Number(estimate.markup_percent),
      markup_amount:  Number(estimate.markup_amount),
      tax_percent:    Number(estimate.tax_percent),
      tax_amount:     Number(estimate.tax_amount),
      total:          Number(estimate.total),
      notes:          estimate.notes,
    },
    customer: {
      name:    customer?.name    ?? "",
      address: customer?.address ?? null,
      phone:   customer?.phone   ?? null,
      email:   customer?.email   ?? null,
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

  const buffer = await renderToBuffer(doc as React.ReactElement<any>)

  // Upload to documents bucket (public, existing bucket)
  const storagePath = `estimates/${id}.pdf`
  const { error: uploadError } = await supabase.storage
    .from("documents")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: true })

  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from("documents").getPublicUrl(storagePath)
  const pdfUrl = urlData.publicUrl

  // Persist URL on estimate record
  await supabase.from("estimates").update({ pdf_url: pdfUrl }).eq("id", id)

  // Record in file_attachments so it appears in the Files section
  const fileName = `${(estimate.title ?? "Estimate").replace(/[^a-zA-Z0-9 _-]/g, "")}.pdf`
  await supabase.from("file_attachments").upsert(
    {
      user_id:      userId,
      bucket:       "documents",
      storage_path: storagePath,
      file_name:    fileName,
      category:     "pdfs",
      entity_type:  "estimates",
      entity_id:    id,
      size_bytes:   buffer.byteLength,
      mime_type:    "application/pdf",
    },
    { onConflict: "bucket,storage_path,entity_type,entity_id" }
  )

  return Response.json({ url: pdfUrl })
}
