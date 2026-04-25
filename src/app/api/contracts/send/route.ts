import { NextRequest } from "next/server"
import nodemailer from "nodemailer"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: NextRequest) {
  const { contractId, customerId, jobId, recipientEmail, subject, body } =
    await req.json() as {
      contractId:     string
      customerId:     string
      jobId:          string | null
      recipientEmail: string
      subject:        string
      body:           string
    }

  if (!contractId || !customerId || !recipientEmail || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // Fetch contract template (ownership check)
  const { data: contract, error: ctErr } = await supabase
    .from("contract_templates")
    .select("*")
    .eq("id", contractId)
    .eq("user_id", user.id)
    .single()

  if (ctErr || !contract) return Response.json({ error: "Contract not found" }, { status: 404 })

  // Fetch customer (ownership check)
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name")
    .eq("id", customerId)
    .eq("user_id", user.id)
    .single()

  if (custErr || !customer) return Response.json({ error: "Customer not found" }, { status: 404 })

  // Fetch job + PM if provided
  let pmName: string | null = null
  if (jobId) {
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, project_manager:project_managers(name, email)")
      .eq("id", jobId)
      .eq("user_id", user.id)
      .single()
    pmName = (job?.project_manager as any)?.name ?? null
  }

  // Fetch company settings for sender
  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email")
    .eq("user_id", user.id)
    .single()

  // Download contract PDF from storage
  const { data: blob, error: dlErr } = await supabase.storage
    .from(contract.bucket)
    .download(contract.storage_path)

  if (dlErr || !blob) {
    return Response.json({ error: "Could not retrieve contract file" }, { status: 500 })
  }

  const pdfBuffer = Buffer.from(await blob.arrayBuffer())

  // Insert sent_contracts record first so we get the signing_token
  const { data: sentRecord, error: insertErr } = await supabase
    .from("sent_contracts")
    .insert({
      user_id:              user.id,
      contract_template_id: contractId,
      customer_id:          customerId,
      job_id:               jobId ?? null,
      recipient_email:      recipientEmail,
      subject,
      body,
      status:               "sent",
    })
    .select("id, signing_token")
    .single()

  if (insertErr || !sentRecord) {
    return Response.json({ error: "Could not save contract record" }, { status: 500 })
  }

  // Build signing link
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin
  const signingLink = `${appUrl}/sign-contract/${sentRecord.signing_token}`

  // Send email
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST   ?? "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })

  const senderName = pmName ?? company?.company_name ?? ""
  const fromAddress = process.env.SMTP_FROM ?? process.env.SMTP_USER

  const emailBody = `${body}

---
To review and sign this contract digitally, please visit:
${signingLink}

The contract PDF is also attached to this email for your reference.`

  await transporter.sendMail({
    from:    senderName ? `"${senderName}" <${fromAddress}>` : fromAddress,
    to:      recipientEmail,
    subject,
    text:    emailBody,
    attachments: [
      {
        filename:    contract.file_name,
        content:     pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  })

  // Attach to customer's Files section (category = contracts)
  await supabase.from("file_attachments").upsert(
    {
      user_id:      user.id,
      bucket:       contract.bucket,
      storage_path: contract.storage_path,
      file_name:    contract.file_name,
      category:     "contracts",
      entity_type:  "customers",
      entity_id:    customerId,
      size_bytes:   pdfBuffer.byteLength,
      mime_type:    "application/pdf",
    },
    { onConflict: "bucket,storage_path,entity_type,entity_id" }
  )

  // Attach to job's Files section if a job was selected
  if (jobId) {
    await supabase.from("file_attachments").upsert(
      {
        user_id:      user.id,
        bucket:       contract.bucket,
        storage_path: contract.storage_path,
        file_name:    contract.file_name,
        category:     "contracts",
        entity_type:  "jobs",
        entity_id:    jobId,
        size_bytes:   pdfBuffer.byteLength,
        mime_type:    "application/pdf",
      },
      { onConflict: "bucket,storage_path,entity_type,entity_id" }
    )
  }

  // Log communication
  await supabase.from("communication_logs").insert({
    user_id:     user.id,
    customer_id: customerId,
    job_id:      jobId ?? null,
    type:        "custom",
    subject,
    body:        emailBody,
    channel:     "email",
  })

  return Response.json({ success: true })
}
