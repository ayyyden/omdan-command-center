// Shared "get documents ready for a recipient" logic — used by the
// email-a-link Send flow and the in-person Sign Now flow, for one document
// or several sent together. Handles the auto-pairing rule (a template with
// a child pointing at it via attached_to_template_id — e.g. a contract's
// "back" page — always travels right after it) so callers never have to
// think about pairing themselves.

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
  /** signing_token for a single document, or the bundle's signing_token when several */
  token:                 string
  primarySentContractId: string
  contractName:          string
  requiresSignature:     boolean
  contracts:             PreparedContract[]
}

export interface DocumentToSend {
  templateId:        string
  /** Values staff filled in for their own fields (Sales Person Signature,
   *  license number, price…) at Prepare time — merged with the customer's
   *  own fieldValues at final stamping in /api/contracts/sign/[token]. */
  staffFieldValues?: Record<string, string> | null
}

/** Single document (auto-paired with its back page, if any). */
export async function prepareContractsForRecipient(opts: {
  supabase:          SupabaseClient
  userId:            string
  templateId:        string
  customerId:        string
  jobId:             string | null
  recipientEmail:    string
  subject:           string
  body:              string
  staffFieldValues?: Record<string, string> | null
}): Promise<PrepareSigningResult> {
  const { templateId, staffFieldValues, ...rest } = opts
  return prepareDocumentsForRecipient({ ...rest, documents: [{ templateId, staffFieldValues }] })
}

/**
 * Creates the sent_contracts row(s) and attaches each PDF to the customer's
 * (and job's) Files. Several documents (or one with a back page) become ONE
 * bundle: one link, e-sign consent once, then each document in order. Does
 * NOT send email — callers decide whether/how to notify the recipient.
 */
export async function prepareDocumentsForRecipient(opts: {
  supabase:       SupabaseClient
  userId:         string
  documents:      DocumentToSend[]
  customerId:     string
  jobId:          string | null
  recipientEmail: string
  subject:        string
  body:           string
}): Promise<PrepareSigningResult> {
  const { supabase, userId, documents, customerId, jobId, recipientEmail, subject, body } = opts
  if (!documents.length) throw new Error("No documents selected")

  const ids = documents.map((d) => d.templateId)
  const [{ data: mains }, { data: pairs }] = await Promise.all([
    supabase.from("contract_templates").select("id, name, storage_path, bucket, file_name, requires_signature").in("id", ids),
    supabase.from("contract_templates").select("id, name, storage_path, bucket, file_name, attached_to_template_id").in("attached_to_template_id", ids),
  ])

  // In the order chosen, each front page followed by its back page
  type Item = PreparedContract & { staffFieldValues: Record<string, string> | null }
  const items: Item[] = []
  for (const d of documents) {
    const t = (mains ?? []).find((m) => m.id === d.templateId)
    if (!t) throw new Error("Contract not found")
    const values = d.staffFieldValues && Object.keys(d.staffFieldValues).length ? d.staffFieldValues : null
    items.push({ templateId: t.id, name: t.name, storagePath: t.storage_path, bucket: t.bucket, fileName: t.file_name, staffFieldValues: values })
    const p = (pairs ?? []).find((x) => x.attached_to_template_id === t.id)
    if (p) items.push({ templateId: p.id, name: p.name, storagePath: p.storage_path, bucket: p.bucket, fileName: p.file_name, staffFieldValues: values })
  }
  const first = (mains ?? []).find((m) => m.id === documents[0].templateId)!

  let isBundle = false
  let token = ""
  let primarySentContractId = ""

  if (items.length > 1) {
    isBundle = true
    const { data: bundle, error: bundleErr } = await supabase
      .from("contract_bundles")
      .insert({ user_id: userId, customer_id: customerId, job_id: jobId ?? null })
      .select("id, signing_token")
      .single()
    if (bundleErr || !bundle) throw new Error("Could not create contract bundle")
    token = bundle.signing_token

    for (let i = 0; i < items.length; i++) {
      const { data: row, error: insErr } = await supabase
        .from("sent_contracts")
        .insert({
          user_id: userId, contract_template_id: items[i].templateId, customer_id: customerId,
          job_id: jobId ?? null, recipient_email: recipientEmail, subject, body,
          status: "sent", bundle_id: bundle.id, bundle_sort_order: i,
          staff_field_values: items[i].staffFieldValues,
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
        user_id: userId, contract_template_id: items[0].templateId, customer_id: customerId,
        job_id: jobId ?? null, recipient_email: recipientEmail, subject, body, status: "sent",
        staff_field_values: items[0].staffFieldValues,
      })
      .select("id, signing_token")
      .single()
    if (insErr || !row) throw new Error("Could not save contract record")
    token = row.signing_token
    primarySentContractId = row.id
  }

  // Attach every document in the set to the customer's (and job's) Files.
  for (const t of items) {
    const { data: blob } = await supabase.storage.from(t.bucket).download(t.storagePath)
    if (!blob) continue
    const size = (await blob.arrayBuffer()).byteLength
    const targets: [string, string][] = [["customers", customerId]]
    if (jobId) targets.push(["jobs", jobId])
    for (const [entity_type, entity_id] of targets) {
      await supabase.from("file_attachments").upsert(
        { user_id: userId, bucket: t.bucket, storage_path: t.storagePath, file_name: t.fileName,
          category: "contracts", entity_type, entity_id, size_bytes: size, mime_type: "application/pdf" },
        { onConflict: "bucket,storage_path,entity_type,entity_id" }
      )
    }
  }

  return {
    isBundle,
    token,
    primarySentContractId,
    contractName: documents.length > 1 ? `${documents.length} documents` : first.name,
    requiresSignature: first.requires_signature,
    contracts: items.map(({ templateId, name, storagePath, bucket, fileName }) => ({ templateId, name, storagePath, bucket, fileName })),
  }
}
