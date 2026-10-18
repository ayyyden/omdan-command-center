import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { createServiceClient } from "@/lib/supabase/service"
import { logAudit, hashToken, getIp, getUa } from "@/lib/approval-audit"
import { SignClient, type SignDoc } from "@/app/sign-contract/[token]/sign-client"
import { sortForFilling } from "@/lib/contracts/fill-order"

// One link for a set of documents sent together: the customer agrees to
// e-signing once, then sees each document already filled with the
// company's part and signs them in order (sign-client.tsx). Coming back
// later picks up at the first one not signed yet.
export default async function SignBundlePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: bundle } = await supabase
    .from("contract_bundles")
    .select("id")
    .eq("signing_token", token)
    .single()
  if (!bundle) notFound()

  const { data: contracts } = await supabase
    .from("sent_contracts")
    .select("id, signing_token, signed_at, recipient_email, bundle_sort_order, contract_template:contract_templates (id, name)")
    .eq("bundle_id", bundle.id)
    .order("bundle_sort_order")
  if (!contracts?.length) notFound()

  const total = contracts.length
  const pending = contracts.filter((c) => !c.signed_at)

  if (!pending.length) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">All Done!</h1>
          <p className="text-gray-500">All {total} document{total !== 1 ? "s" : ""} have been signed.</p>
          <p className="text-sm text-gray-400 mt-2">You may close this window.</p>
        </div>
      </div>
    )
  }

  const hdrs = await headers()
  for (const c of pending) {
    void logAudit({
      documentType: "contract", documentId: c.id, tokenHash: hashToken(c.signing_token), action: "viewed",
      customerEmail: c.recipient_email ?? null, ipAddress: getIp(hdrs), userAgent: getUa(hdrs),
      metadata: { bundle: true },
    })
  }

  // Customer-facing fields only — staff fields were filled before sending
  // and are already stamped into each document's preview
  const templateIds = pending.map((c) => (c.contract_template as unknown as { id: string }).id)
  const { data: fields } = await supabase
    .from("contract_fields")
    .select("id, page_number, field_type, label, required, contract_template_id, x, y, options")
    .in("contract_template_id", templateIds)
    .eq("fill_role", "customer")
    .order("page_number")

  const docs: SignDoc[] = pending.map((c) => {
    const t = c.contract_template as unknown as { id: string; name: string }
    return {
      token: c.signing_token,
      name: t.name,
      fields: sortForFilling((fields ?? []).filter((f) => f.contract_template_id === t.id)) as SignDoc["fields"],
    }
  })

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return (
    <SignClient
      docs={docs}
      alreadySigned={total - pending.length}
      companyName={company?.company_name ?? "Omdan Development"}
      companyPhone={company?.phone ?? null}
      companyEmail={company?.email ?? null}
    />
  )
}
