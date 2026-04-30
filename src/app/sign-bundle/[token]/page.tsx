import { notFound, redirect } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/service"

export default async function SignBundlePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
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
    .select("id, signing_token, signed_at, bundle_sort_order")
    .eq("bundle_id", bundle.id)
    .order("bundle_sort_order")

  if (!contracts?.length) notFound()

  const total = contracts.length
  const next = contracts.find((c) => !c.signed_at)

  if (!next) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">All Done!</h1>
          <p className="text-gray-500">
            All {total} contract{total !== 1 ? "s" : ""} have been signed successfully.
          </p>
          <p className="text-sm text-gray-400 mt-2">You may close this window.</p>
        </div>
      </div>
    )
  }

  redirect(`/sign-contract/${next.signing_token}?bundle=${token}`)
}
