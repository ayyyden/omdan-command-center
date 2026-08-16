import { NextRequest } from "next/server"
import { PDFDocument, rgb, StandardFonts } from "pdf-lib"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, buildHtmlEmail } from "@/lib/email"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { notifyLia } from "@/lib/lia-notifications"
import { ensureJobForSigning } from "@/lib/contracts/auto-job"
import { stampFieldsOntoPdf } from "@/lib/contracts/stamp-pdf"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    return await handleSign(req, params)
  } catch (err: any) {
    console.error("[sign] unhandled error:", err)
    return Response.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    )
  }
}

async function handleSign(
  req: NextRequest,
  params: Promise<{ token: string }>,
) {
  const { token } = await params
  const body = await req.json() as {
    signerName:   string
    fieldValues?: Record<string, string>  // fieldId → value
  }

  const { signerName, fieldValues: customerFieldValues = {} } = body

  if (!signerName) {
    return Response.json({ error: "Missing signer name" }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Fetch sent contract by token
  const { data: sent, error: sentErr } = await supabase
    .from("sent_contracts")
    .select(`
      id, user_id, customer_id, job_id,
      signing_token, signed_at, recipient_email, staff_field_values,
      contract_template:contract_templates (
        id, name, storage_path, bucket, file_name
      )
    `)
    .eq("signing_token", token)
    .single()

  if (sentErr || !sent) {
    return Response.json({ error: "Contract not found" }, { status: 404 })
  }

  if (sent.signed_at) {
    return Response.json({ error: "Already signed" }, { status: 409 })
  }

  const template = sent.contract_template as unknown as {
    id: string
    name: string
    storage_path: string
    bucket: string
    file_name: string
  }

  // Load field definitions
  const { data: fieldDefs } = await supabase
    .from("contract_fields")
    .select("*")
    .eq("contract_template_id", template.id)
    .order("created_at")

  // Download original PDF
  const { data: blob, error: dlErr } = await supabase.storage
    .from(template.bucket)
    .download(template.storage_path)

  if (dlErr || !blob) {
    return Response.json({ error: "Could not retrieve contract file" }, { status: 500 })
  }

  const originalBytes = await blob.arrayBuffer()
  const pdfDoc = await PDFDocument.load(originalBytes)

  // Staff filled their own fields (Sales Person Signature, license number,
  // etc.) at Prepare time, before the customer ever saw this document —
  // merge those in alongside what the customer just submitted. Customer
  // values win on any (unexpected) overlap since they're the one actually
  // completing this request right now.
  const fieldValues: Record<string, string> = {
    ...((sent.staff_field_values as Record<string, string> | null) ?? {}),
    ...customerFieldValues,
  }

  await stampFieldsOntoPdf(pdfDoc, (fieldDefs ?? []) as any, fieldValues)

  // ── Audit footer on last page (tiny, below all content) ─────────────────────

  const italicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique)
  const pages = pdfDoc.getPages()
  const lastPage = pages[pages.length - 1]

  const now = new Date()
  const dateStr = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })

  // Single compact line at y=8 — well below any contract content
  lastPage.drawText(
    `Electronically signed by ${signerName} on ${dateStr}`,
    { x: 40, y: 8, size: 6.5, font: italicFont, color: rgb(0.55, 0.55, 0.55) },
  )

  // ── Upload signed PDF ────────────────────────────────────────────────────────

  const signedBytes  = await pdfDoc.save()
  const signedBuffer = Buffer.from(signedBytes)
  const signedPath   = `${sent.user_id}/signed_contracts/${sent.id}_signed.pdf`

  const { error: upErr } = await supabase.storage
    .from("files")
    .upload(signedPath, signedBuffer, { contentType: "application/pdf", upsert: true })

  if (upErr) {
    console.error("[sign] storage upload error:", upErr)
    return Response.json({ error: `Storage upload failed: ${upErr.message}` }, { status: 500 })
  }

  const signedAt = now.toISOString()
  const safeName = template.file_name.replace(/\.pdf$/i, "")
  const signedFileName = `${safeName}_signed.pdf`

  // ── Update record ────────────────────────────────────────────────────────────

  await supabase
    .from("sent_contracts")
    .update({ status: "signed", signed_at: signedAt, signer_name: signerName, signed_pdf_path: signedPath })
    .eq("id", sent.id)

  // A contract signed while only linked to a customer/lead (no job yet —
  // the common case, since jobs are usually created only after a lead is
  // sold) becomes the moment that customer becomes a real job. Reuses their
  // most recent job if one already exists instead of creating a duplicate.
  let jobId = sent.job_id as string | null
  try {
    jobId = await ensureJobForSigning(supabase, sent.user_id, sent.customer_id, sent.job_id)
    if (jobId !== sent.job_id) {
      await supabase.from("sent_contracts").update({ job_id: jobId }).eq("id", sent.id)
      // Backfill bundle siblings too (e.g. the auto-attached "back" page)
      // so they land in the same job's Files instead of being orphaned.
      const { data: bundleRow } = await supabase
        .from("sent_contracts")
        .select("bundle_id")
        .eq("id", sent.id)
        .single()
      if (bundleRow?.bundle_id) {
        await supabase.from("sent_contracts").update({ job_id: jobId }).eq("bundle_id", bundleRow.bundle_id)
      }
    }
  } catch (err) {
    console.error("[sign] auto-job-creation failed (non-fatal):", err)
  }

  void logAudit({
    documentType:  "contract",
    documentId:    sent.id,
    tokenHash:     hashToken(token),
    action:        "signed",
    customerEmail: sent.recipient_email ?? null,
    ipAddress:     getIp(req.headers),
    userAgent:     getUa(req.headers),
    metadata: {
      signer_name:    signerName,
      contract_name:  template.name,
      field_count:    fieldDefs?.length ?? 0,
      signed_pdf_path: signedPath,
    },
  })

  // ── Attach files ─────────────────────────────────────────────────────────────

  await supabase.from("file_attachments").upsert(
    { user_id: sent.user_id, bucket: "files", storage_path: signedPath, file_name: signedFileName,
      category: "signed_contracts", entity_type: "customers", entity_id: sent.customer_id,
      size_bytes: signedBuffer.byteLength, mime_type: "application/pdf" },
    { onConflict: "bucket,storage_path,entity_type,entity_id" }
  )

  if (jobId) {
    await supabase.from("file_attachments").upsert(
      { user_id: sent.user_id, bucket: "files", storage_path: signedPath, file_name: signedFileName,
        category: "signed_contracts", entity_type: "jobs", entity_id: jobId,
        size_bytes: signedBuffer.byteLength, mime_type: "application/pdf" },
      { onConflict: "bucket,storage_path,entity_type,entity_id" }
    )
  }

  // ── Notify business + confirm to customer ────────────────────────────────────

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email, phone")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: customer } = await supabase
    .from("customers")
    .select("name, email")
    .eq("id", sent.customer_id)
    .single()

  await supabase.from("communication_logs").insert({
    user_id: sent.user_id, customer_id: sent.customer_id, job_id: jobId ?? null,
    type: "custom", subject: `Contract signed: ${template.name}`,
    body: `${signerName} signed "${template.name}" on ${dateStr}.`, channel: "email",
  })

  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    const companyName = company?.company_name ?? "Omdan"
    try {
      const transporter = createTransporter()

      if (company?.email) {
        const bizHtml = buildHtmlEmail({
          title: "Contract Signed",
          preheader: `${signerName} has signed "${template.name}".`,
          companyName,
          bodyLines: [
            `<strong>${signerName}</strong> has signed the contract.`,
            "",
            `<strong>Contract:</strong> ${template.name}`,
            `<strong>Signed:</strong> ${dateStr}`,
          ],
        })
        await transporter.sendMail({
          from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
          to:      company.email,
          subject: `Contract Signed: ${template.name}`,
          text:    `${signerName} has signed the contract "${template.name}" on ${dateStr}.`,
          html:    bizHtml,
          attachments: [{ filename: signedFileName, content: signedBuffer, contentType: "application/pdf" }],
        })
      }

      // Use the email this document was actually sent/signed to, not the
      // customer's stored profile email — staff may have typed a different
      // one in the recipient picker (or the customer record may have none
      // on file at all), and that's the one the signer actually gave us.
      const customerCopyEmail = sent.recipient_email ?? customer?.email ?? null
      if (customerCopyEmail) {
        const custHtml = buildHtmlEmail({
          title: "Your Contract Has Been Signed",
          preheader: `Thank you for signing "${template.name}".`,
          companyName,
          bodyLines: [
            `Hi ${customer?.name ?? signerName},`,
            "",
            `Thank you for signing the contract. We're all set to move forward.`,
            "",
            `<strong>Contract:</strong> ${template.name}`,
            `<strong>Signed:</strong> ${dateStr}`,
            "",
            company?.phone ? `Questions? Call us at ${company.phone}.` : "",
          ].filter((l) => l !== undefined) as string[],
        })
        await transporter.sendMail({
          from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
          to:      customerCopyEmail,
          subject: `Contract signed — ${template.name}`,
          text:    `Hi ${customer?.name ?? signerName}, thank you for signing the contract "${template.name}". The signed copy is attached.`,
          html:    custHtml,
          attachments: [{ filename: signedFileName, content: signedBuffer, contentType: "application/pdf" }],
        })
      }
    } catch (err) {
      // Non-fatal — the signature itself is already saved — but log it so a
      // real SMTP failure is diagnosable instead of silently vanishing.
      console.error("[sign] confirmation email failed:", err)
    }
  }

  // Lia notification (fire-and-forget)
  void (async () => {
    try {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""
      notifyLia({
        event_type:     "contract_signed",
        customer_name:  customer?.name ?? signerName,
        customer_email: customer?.email ?? sent.recipient_email ?? undefined,
        document_name:  template.name,
        crm_url:        jobId
          ? `${appUrl}/jobs/${jobId}`
          : `${appUrl}/customers/${sent.customer_id}`,
      })
    } catch { /* non-fatal */ }
  })()

  return Response.json({ success: true })
}
