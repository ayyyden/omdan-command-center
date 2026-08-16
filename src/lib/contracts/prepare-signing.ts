// Shared "get a document ready for a recipient" logic — used by both the
// email-a-link Send flow and the in-person Sign Now flow. Handles the
// auto-pairing rule (a template with a child pointing at it via
// attached_to_template_id — e.g. a contract's "back" page — always travels
// with it, bundled via the existing contract_bundles mechanism) so callers
// never have to think about pairing themselves.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface PreparedContract {
  templateId:   string
  name:         string
  storagePath:  string
  bucket:       string
  fileName:     string
}

export interface PrepareSigningResult {
  isBundle:              boolean
  /** signing_token for a single document, or the bundle's signing_token when paired */
  token:                 string
  primarySentContractId: string
  contractName:          string
  requiresSignature:     boolean
  contracts:             PreparedContract[]
}

/**
 * Creates the sent_contracts row(s) for a document (auto-bundling with its
 * paired "back" page if one exists), and attaches each PDF to the
 * customer's (and job's, if given) Files section. Does NOT send email —
 * callers decide whether/how to notify the recipient.
 */
export async function prepareContractsForRecipient(opts: {
  supabase:          SupabaseClient
  userId:            string
  templateId:        string
  customerId:        string
  jobId:             string | null
  recipientEmail:    string
  subject:           string
  body:               string
  /** Values staff filled in for their own fields (Sales Person Signature,
   *  license number, etc.) at Prepare time — merged with the customer's
   *  own fieldValues at final stamping in /api/contracts/sign/[token]. */
  staffFieldValues?: Record<string, string> | null
}): Promise<PrepareSigningResult> {
  const { supabase, userId, templateId, customerId, jobId, recipientEmail, subject, body, staffFieldValues } = opts

  const { data: template, error: templateErr } = await supabase
    .from("contract_templates")
    .select("id, name, storage_path, bucket, file_name, requires_signature")
    .eq("id", templateId)
    .single()

  if (templateErr || !template) throw new Error("Contract not found")

  const { data: paired } = await supabase
    .from("contract_templates")
    .select("id, name, storage_path, bucket, file_name")
    .eq("attached_to_template_id", templateId)
    .maybeSingle()

  const templates: PreparedContract[] = [
    { templateId: template.id, name: template.name, storagePath: template.storage_path, bucket: template.bucket, fileName: template.file_name },
  ]
  if (paired) {
    templates.push({ templateId: paired.id, name: paired.name, storagePath: paired.storage_path, bucket: paired.bucket, fileName: paired.file_name })
  }

  let isBundle = false
  let token = ""
  let primarySentContractId = ""

  if (templates.length > 1) {
    isBundle = true
    const { data: bundle, error: bundleErr } = await supabase
      .from("contract_bundles")
      .insert({ user_id: userId, customer_id: customerId, job_id: jobId ?? null })
      .select("id, signing_token")
      .single()

    if (bundleErr || !bundle) throw new Error("Could not create contract bundle")
    token = bundle.signing_token

    for (let i = 0; i < templates.length; i++) {
      const { data: row, error: insErr } = await supabase
        .from("sent_contracts")
        .insert({
          user_id: userId, contract_template_id: templates[i].templateId, customer_id: customerId,
          job_id: jobId ?? null, recipient_email: recipientEmail, subject, body,
          status: "sent", bundle_id: bundle.id, bundle_sort_order: i,
          staff_field_values: staffFieldValues ?? null,
        })
        .select("id")
        .single()

      if (insErr || !row) throw new Error("Could not save contract record")
      if (i === 0) primarySentContractId = row.id
    }
  } else {
    const { data: row, error: insErr } = await supabase
      .from("sent_contracts")
      .insert({
        user_id: userId, contract_template_id: templateId, customer_id: customerId,
        job_id: jobId ?? null, recipient_email: recipientEmail, subject, body, status: "sent",
        staff_field_values: staffFieldValues ?? null,
      })
      .select("id, signing_token")
      .single()

    if (insErr || !row) throw new Error("Could not save contract record")
    token = row.signing_token
    primarySentContractId = row.id
  }

  // Attach every document in the set to the customer's (and job's) Files.
  for (const t of templates) {
    const { data: blob } = await supabase.storage.from(t.bucket).download(t.storagePath)
    if (!blob) continue
    const buf = Buffer.from(await blob.arrayBuffer())

    await supabase.from("file_attachments").upsert(
      { user_id: userId, bucket: t.bucket, storage_path: t.storagePath, file_name: t.fileName,
        category: "contracts", entity_type: "customers", entity_id: customerId,
        size_bytes: buf.byteLength, mime_type: "application/pdf" },
      { onConflict: "bucket,storage_path,entity_type,entity_id" }
    )

    if (jobId) {
      await supabase.from("file_attachments").upsert(
        { user_id: userId, bucket: t.bucket, storage_path: t.storagePath, file_name: t.fileName,
          category: "contracts", entity_type: "jobs", entity_id: jobId,
          size_bytes: buf.byteLength, mime_type: "application/pdf" },
        { onConflict: "bucket,storage_path,entity_type,entity_id" }
      )
    }
  }

  return {
    isBundle,
    token,
    primarySentContractId,
    contractName: template.name,
    requiresSignature: template.requires_signature,
    contracts: templates,
  }
}
