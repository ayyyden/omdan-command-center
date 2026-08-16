import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"

export async function POST(req: NextRequest) {
  const { sentContractId } = (await req.json()) as { sentContractId: string }
  if (!sentContractId) return Response.json({ error: "Missing sentContractId" }, { status: 400 })

  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { supabase } = session

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select(`
      id, signing_token, recipient_email, subject, body, status,
      contract_template:contract_templates (bucket, storage_path, file_name, name, requires_signature)
    `)
    .eq("id", sentContractId)
    .single()

  if (!sent) return Response.json({ error: "Contract record not found" }, { status: 404 })
  if (sent.status === "signed") return Response.json({ error: "Contract already signed" }, { status: 400 })

  const template = sent.contract_template as unknown as {
    bucket: string
    storage_path: string
    file_name: string
    name: string
    requires_signature: boolean
  }

  const { data: blob } = await supabase.storage.from(template.bucket).download(template.storage_path)
  if (!blob) return Response.json({ error: "Could not retrieve contract file" }, { status: 500 })
  const pdfBuffer = Buffer.from(await blob.arrayBuffer())

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const signingLink = `${appUrl}/sign-contract/${sent.signing_token}`
  const companyName = company?.company_name ?? "Omdan"
  const body = sent.body ?? ""

  const htmlBody = buildHtmlEmail({
    title: `Contract: ${template.name}`,
    preheader: template.requires_signature ? "Please review and sign your contract." : template.name,
    companyName,
    bodyLines: template.requires_signature
      ? [body, "", "Click the button below to review and sign electronically. The document is also attached for your reference."]
      : [body],
    ctaLabel: template.requires_signature ? "Review & Sign" : undefined,
    ctaUrl:   template.requires_signature ? signingLink : undefined,
  })

  const plainText = template.requires_signature
    ? `${body}\n\n---\nTo review and sign this document digitally, please visit:\n${signingLink}\n\nThe document is also attached to this email for your reference.`
    : body

  const transporter = createTransporter()
  await transporter.sendMail({
    from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to: sent.recipient_email,
    subject: sent.subject ?? `Contract: ${template.name}`,
    text: plainText,
    html: htmlBody,
    attachments: [{ filename: template.file_name, content: pdfBuffer, contentType: "application/pdf" }],
  })

  return Response.json({ success: true })
}
