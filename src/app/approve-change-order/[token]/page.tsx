import { notFound } from "next/navigation"
import { createServiceClient } from "@/lib/supabase/service"
import { ApproveChangeOrderClient } from "./approve-client"

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n)
}

export default async function ApproveChangeOrderPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const supabase = createServiceClient()

  const { data: co } = await supabase
    .from("change_orders")
    .select(`
      id, title, description, amount, notes, status,
      approved_at, rejected_at, created_at, user_id, approval_token,
      customer:customers(name, email, phone),
      job:jobs(title)
    `)
    .eq("approval_token", token)
    .single()

  if (!co) notFound()

  const { data: company } = await supabase
    .from("company_settings")
    .select("company_name, phone, email, address, logo_url, license_number")
    .eq("user_id", co.user_id)
    .single()

  const customer = co.customer as unknown as {
    name: string; email: string | null; phone: string | null
  } | null
  const job = co.job as unknown as { title: string } | null

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-4">

        {/* Company header */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-start gap-4">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.logo_url}
                alt={company.company_name ?? "Company logo"}
                className="w-14 h-14 rounded-xl object-contain shrink-0 border border-gray-100"
              />
            )}
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-gray-900 leading-tight">
                {company?.company_name ?? "Change Order"}
              </h1>
              {company?.address && (
                <p className="text-sm text-gray-500 mt-0.5">{company.address}</p>
              )}
              <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                {company?.phone && (
                  <a href={`tel:${company.phone}`} className="text-sm text-gray-500 hover:text-gray-700">
                    {company.phone}
                  </a>
                )}
                {company?.email && (
                  <a href={`mailto:${company.email}`} className="text-sm text-gray-500 hover:text-gray-700">
                    {company.email}
                  </a>
                )}
              </div>
              {company?.license_number && (
                <p className="text-xs text-gray-400 mt-1">Lic. {company.license_number}</p>
              )}
            </div>
          </div>
        </div>

        {/* Change order card */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          {/* Title bar */}
          <div className="px-6 py-5 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
              Change Order
            </p>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">{co.title}</h2>
            {customer?.name && (
              <p className="text-sm text-gray-500 mt-1">Prepared for {customer.name}</p>
            )}
            {job?.title && (
              <p className="text-sm text-gray-400 mt-0.5">Job: {job.title}</p>
            )}
          </div>

          {/* Description */}
          {co.description && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Description
              </p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {co.description}
              </p>
            </div>
          )}

          {/* Amount */}
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-600">Additional Amount</span>
              <span className="text-2xl font-bold text-gray-900">{fmt(Number(co.amount))}</span>
            </div>
          </div>

          {/* Notes */}
          {co.notes && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-2">
                Notes
              </p>
              <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                {co.notes}
              </p>
            </div>
          )}

          {/* Action area */}
          <div className="px-6 py-6">
            <ApproveChangeOrderClient
              token={token}
              initialStatus={co.status}
              approvedAt={co.approved_at}
            />
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 pb-4">
          Questions? Contact us at{" "}
          {company?.email ? (
            <a href={`mailto:${company.email}`} className="underline hover:text-gray-600">
              {company.email}
            </a>
          ) : (
            company?.company_name ?? "us"
          )}
        </p>
      </div>
    </div>
  )
}
