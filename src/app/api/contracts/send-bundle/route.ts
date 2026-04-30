import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"

export async function POST(req: NextRequest) {
  const {
    contractIds,
    customerId,
    jobId,
    recipientEmail,
    subject,
    body,
  } = await req.json() as {
    contractIds:    string[]
    customerId:     string
    jobId:          string | null
    recipientEmail: string
    subject:        string
    body:           string
  }

  if (!contractIds?.length || !customerId || !recipientEmail || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  const session = await requirePermission("contracts:send")
  if (session instanceof Response) return session
  const { userId, supabase } = session

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, email")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: customer } = await supabase
    .from("customers")
    .select("id, name")
    .eq("id", customerId)
    .single()

  if (!customer) return Response.json({ error: "Customer not found" }, { status: 404 })

  // Fetch contracts in the order specified by contractIds
  const { data: contractsUnordered } = await supabase
    .from("contract_templates")
    .select("id, name, storage_path, bucket, file_name")
    .in("id", contractIds)
    .eq("is_active", true)

  if (!contractsUnordered?.length) return Response.json({ error: "No valid contracts found" }, { status: 404 })

  // Preserve the selection order
  const contracts = contractIds
    .map((id) => contractsUnordered.find((c) => c.id === id))
    .filter(Boolean) as typeof contractsUnordered

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const companyName = company?.company_name ?? "Omdan"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin

  // Create a single bundle record
  const { data: bundle, error: bundleErr } = await supabase
    .from("contract_bundles")
    .insert({ user_id: userId, customer_id: customerId, job_id: jobId ?? null })
    .select("id, signing_token")
    .single()

  if (bundleErr || !bundle) {
    return Response.json({ error: "Could not create bundle" }, { status: 500 })
  }

  // Create sent_contracts for each contract, in order
  let successCount = 0
  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i]

    const { data: sentRecord, error: insertErr } = await supabase
      .from("sent_contracts")
      .insert({
        user_id:              userId,
        contract_template_id: contract.id,
        customer_id:          customerId,
        job_id:               jobId ?? null,
        recipient_email:      recipientEmail,
        subject,
        body,
        status:               "sent",
        bundle_id:            bundle.id,
        bundle_sort_order:    i,
      })
      .select("id")
      .single()

    if (insertErr || !sentRecord) continue

    // Attach to customer files
    const { data: blob } = await supabase.storage
      .from(contract.bucket)
      .download(contract.storage_path)

    if (blob) {
      const pdfBuffer = Buffer.from(await blob.arrayBuffer())

      await supabase.from("file_attachments").upsert(
        {
          user_id: userId, bucket: contract.bucket, storage_path: contract.storage_path,
          file_name: contract.file_name, category: "contracts",
          entity_type: "customers", entity_id: customerId,
          size_bytes: pdfBuffer.byteLength, mime_type: "application/pdf",
        },
        { onConflict: "bucket,storage_path,entity_type,entity_id" }
      )

      if (jobId) {
        await supabase.from("file_attachments").upsert(
          {
            user_id: userId, bucket: contract.bucket, storage_path: contract.storage_path,
            file_name: contract.file_name, category: "contracts",
            entity_type: "jobs", entity_id: jobId,
            size_bytes: pdfBuffer.byteLength, mime_type: "application/pdf",
          },
          { onConflict: "bucket,storage_path,entity_type,entity_id" }
        )
      }
    }

    successCount++
  }

  if (successCount === 0) {
    return Response.json({ error: "Could not prepare any contracts" }, { status: 500 })
  }

  const bundleLink = `${appUrl}/sign-bundle/${bundle.signing_token}`
  const contractList = contracts
    .slice(0, successCount)
    .map((c, i) => `${i + 1}. ${c.name}`)
    .join("\n")

  const htmlBody = buildHtmlEmail({
    title: successCount > 1 ? "Contracts Ready for Signing" : `Contract: ${contracts[0].name}`,
    preheader: `Please review and sign ${successCount > 1 ? `${successCount} contracts` : "your contract"}.`,
    companyName,
    bodyLines: [
      body,
      "",
      successCount > 1
        ? `You have <strong>${successCount} contracts</strong> to sign:`
        : "You have a contract to sign:",
      ...contracts.slice(0, successCount).map((c, i) => `${i + 1}. ${c.name}`),
      "",
      "Click the button below to begin. Contracts are presented one at a time in order.",
    ],
    ctaLabel: successCount > 1 ? "Sign All Contracts" : "Sign Contract",
    ctaUrl: bundleLink,
  })

  const plainText = [
    body,
    "",
    successCount > 1 ? `You have ${successCount} contracts to sign:` : "You have a contract to sign:",
    contractList,
    "",
    `Sign here: ${bundleLink}`,
  ].join("\n")

  const transporter = createTransporter()
  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to:      recipientEmail,
    subject,
    text:    plainText,
    html:    htmlBody,
  })

  await supabase.from("communication_logs").insert({
    user_id:     userId,
    customer_id: customerId,
    job_id:      jobId ?? null,
    type:        "custom",
    subject,
    body:        plainText,
    channel:     "email",
  })

  return Response.json({ success: true, count: successCount })
}
