import { NextRequest } from "next/server"
import nodemailer from "nodemailer"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const { sentContractId } = (await req.json()) as { sentContractId: string }
  if (!sentContractId) return Response.json({ error: "Missing sentContractId" }, { status: 400 })

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select(`
      id, signing_token, recipient_email, subject, body, status,
      contract_template:contract_templates (bucket, storage_path, file_name)
    `)
    .eq("id", sentContractId)
    .single()

  if (!sent) return Response.json({ error: "Contract record not found" }, { status: 404 })
  if (sent.status === "signed") return Response.json({ error: "Contract already signed" }, { status: 400 })

  const template = sent.contract_template as unknown as {
    bucket: string
    storage_path: string
    file_name: string
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

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const signingLink = `${appUrl}/sign-contract/${sent.signing_token}`

  const emailBody = `${sent.body ?? ""}

---
To review and sign this contract digitally, please visit:
${signingLink}

The contract PDF is also attached to this email for your reference.`

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  const senderName = company?.company_name ?? ""
  const fromAddress = process.env.SMTP_FROM ?? process.env.SMTP_USER

  await transporter.sendMail({
    from: senderName ? `"${senderName}" <${fromAddress}>` : fromAddress,
    to: sent.recipient_email,
    subject: sent.subject ?? "Contract for signing",
    text: emailBody,
    attachments: [
      {
        filename: template.file_name,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  })

  return Response.json({ success: true })
}
