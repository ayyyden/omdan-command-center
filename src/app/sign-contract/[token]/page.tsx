import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/service"
import { SignClient } from "./sign-client"

export default async function SignContractPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: sent } = await supabase
    .from("sent_contracts")
    .select(`
      id,
      signing_token,
      signed_at,
      signer_name,
      recipient_email,
      status,
      contract_template:contract_templates (
        id, name, storage_path, bucket, file_name
      )
    `)
    .eq("signing_token", token)
    .single()

  if (!sent) notFound()

  if (sent.signed_at) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Already Signed</h1>
          <p className="text-gray-500">
            This contract was signed by{" "}
            <span className="font-medium text-gray-700">{sent.signer_name}</span>.
          </p>
        </div>
      </div>
    )
  }

  const template = sent.contract_template as unknown as {
    id: string
    name: string
    storage_path: string
    bucket: string
    file_name: string
  }

  // Load fields for this template
  const { data: fields } = await supabase
    .from("contract_fields")
    .select("id, page_number, field_type, label, x, y, width, height, required, options")
    .eq("contract_template_id", template.id)
    .order("created_at")

  // Generate a 2-hour signed URL for PDF viewing
  const { data: urlData } = await supabase.storage
    .from(template.bucket)
    .createSignedUrl(template.storage_path, 7200)

  const pdfUrl = urlData?.signedUrl ?? null

  return (
    <SignClient
      token={token}
      contractName={template.name}
      pdfUrl={pdfUrl}
      fields={(fields ?? []) as any}
    />
  )
}
