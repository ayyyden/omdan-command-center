import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { prepareContractsForRecipient } from "@/lib/contracts/prepare-signing"

export async function POST(req: NextRequest) {
  const { contractId, customerId, jobId, recipientEmail, subject, body, staffFieldValues } =
    await req.json() as {
      contractId:       string
      customerId:       string
      jobId:            string | null
      recipientEmail:   string
      subject:          string
      body:             string
      staffFieldValues?: Record<string, string> | null
    }

  if (!contractId || !customerId || !recipientEmail || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { userId, supabase } = session

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name")
    .eq("id", customerId)
    .single()
  if (custErr || !customer) return Response.json({ error: "Customer not found" }, { status: 404 })

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  let result
  try {
    result = await prepareContractsForRecipient({
      supabase, userId, templateId: contractId, customerId, jobId: jobId ?? null,
      recipientEmail, subject, body,
      staffFieldValues,
    })
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "Could not prepare document" }, { status: 500 })
  }

  const companyName = company?.company_name ?? "Omdan"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin

  // Attach every PDF in the set (front + auto-paired back, if any) so the
  // recipient has the documents even before/instead of clicking through.
  const attachments = []
  for (const c of result.contracts) {
    const { data: blob } = await supabase.storage.from(c.bucket).download(c.storagePath)
    if (blob) attachments.push({ filename: c.fileName, content: Buffer.from(await blob.arrayBuffer()), contentType: "application/pdf" })
  }

  const signingLink = result.isBundle
    ? `${appUrl}/sign-bundle/${result.token}`
    : `${appUrl}/sign-contract/${result.token}`

  const transporter = createTransporter()

  if (result.requiresSignature) {
    const htmlBody = buildHtmlEmail({
      title: `Contract: ${result.contractName}`,
      preheader: "Please review and sign your contract.",
      companyName,
      bodyLines: [body, "", "Click the button below to review and sign electronically. The document is also attached for your reference."],
      ctaLabel: "Review & Sign",
      ctaUrl: signingLink,
    })
    const plainText = `${body}\n\n---\nTo review and sign this document digitally, please visit:\n${signingLink}\n\nThe document is also attached to this email for your reference.`

    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: recipientEmail, subject, text: plainText, html: htmlBody, attachments,
    })
  } else {
    // Send-only document — no signing step, just deliver the file(s).
    const htmlBody = buildHtmlEmail({
      title: result.contractName,
      preheader: body.slice(0, 120),
      companyName,
      bodyLines: [body],
    })
    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: recipientEmail, subject, text: body, html: htmlBody, attachments,
    })
  }

  await supabase.from("communication_logs").insert({
    user_id: userId, customer_id: customerId, job_id: jobId ?? null,
    type: "custom", subject, body, channel: "email",
  })

  return Response.json({ success: true })
}
