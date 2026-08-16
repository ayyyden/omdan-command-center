import { NextRequest } from "next/server"
import { PDFDocument } from "pdf-lib"
import { createServiceClient } from "@/lib/supabase/service"
import { stampFieldsOntoPdf } from "@/lib/contracts/stamp-pdf"

// Public, token-gated — lets a customer actually see what they're signing
// before they sign it: the original document with whatever staff already
// filled in (Sales Person Signature, license number, price, etc.) stamped
// on, and their own still-blank fields left exactly as blank lines. Always
// generated live from the current staff_field_values — nothing is
// persisted, so it can never go stale.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: sent, error: sentErr } = await supabase
    .from("sent_contracts")
    .select(`
      staff_field_values,
      contract_template:contract_templates (id, name, storage_path, bucket, file_name)
    `)
    .eq("signing_token", token)
    .single()

  if (sentErr || !sent) {
    return Response.json({ error: "Contract not found" }, { status: 404 })
  }

  const template = sent.contract_template as unknown as {
    id: string
    name: string
    storage_path: string
    bucket: string
    file_name: string
  }

  const { data: fieldDefs } = await supabase
    .from("contract_fields")
    .select("*")
    .eq("contract_template_id", template.id)
    .order("created_at")

  const { data: blob, error: dlErr } = await supabase.storage
    .from(template.bucket)
    .download(template.storage_path)

  if (dlErr || !blob) {
    return Response.json({ error: "Could not retrieve contract file" }, { status: 500 })
  }

  const pdfDoc = await PDFDocument.load(await blob.arrayBuffer())

  const staffFieldValues = (sent.staff_field_values as Record<string, string> | null) ?? {}
  await stampFieldsOntoPdf(pdfDoc, (fieldDefs ?? []) as any, staffFieldValues)

  const bytes = await pdfDoc.save()

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${template.file_name}"`,
      "Cache-Control": "no-store",
    },
  })
}
