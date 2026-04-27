import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Badge } from "@/components/ui/badge"
import { UploadContractDialog } from "@/components/contracts/upload-contract-dialog"
import { SendContractDialog } from "@/components/contracts/send-contract-dialog"
import { ContractActions } from "@/components/contracts/contract-actions"
import { SentContractsTable } from "@/components/contracts/sent-contracts-table"
import { formatDate } from "@/lib/utils"
import { ScrollText } from "lucide-react"

export default async function ContractsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [
    { data: contracts },
    { data: customers },
    { data: templates },
    { data: companySettings },
    { data: sentContracts },
  ] = await Promise.all([
    supabase
      .from("contract_templates")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name, email")
      .eq("is_archived", false)
      .order("name"),
    supabase
      .from("message_templates")
      .select("id, name, subject, body")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("company_settings")
      .select("company_name, email")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("sent_contracts")
      .select(`
        id, signing_token, recipient_email, status, sent_at, signed_at,
        signer_name, signed_pdf_path, subject, body,
        contract_template:contract_templates (id, name),
        customer:customers (id, name),
        job:jobs (id, title)
      `)
      .order("sent_at", { ascending: false }),
  ])

  const rows = contracts ?? []
  const activeCount = rows.filter((c) => c.is_active).length
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""

  return (
    <div>
      <Topbar
        title="Contracts"
        subtitle={`${rows.length} template${rows.length !== 1 ? "s" : ""} · ${activeCount} active`}
        actions={<UploadContractDialog userId={user.id} />}
      />

      <div className="p-4 sm:p-6 space-y-8">
        {/* Templates section */}
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <ScrollText className="w-10 h-10 text-muted-foreground/40 mb-4" />
            <p className="text-base font-medium text-muted-foreground">No contracts yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1">
              Upload a PDF contract template to get started.
            </p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="sm:hidden space-y-3">
              {rows.map((contract) => (
                <div key={contract.id} className="rounded-lg border bg-card p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight">{contract.name}</p>
                    <Badge variant={contract.is_active ? "default" : "secondary"} className="shrink-0">
                      {contract.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {contract.description && (
                    <p className="text-sm text-muted-foreground leading-snug">{contract.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">Uploaded {formatDate(contract.created_at)}</p>
                  <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                    <SendContractDialog
                      contract={{ id: contract.id, name: contract.name }}
                      customers={(customers ?? []) as { id: string; name: string; email: string | null }[]}
                      templates={(templates ?? []) as { id: string; name: string; subject: string | null; body: string }[]}
                      companySettings={companySettings ?? null}
                      userId={user.id}
                    />
                    <ContractActions
                      contract={{
                        id:           contract.id,
                        name:         contract.name,
                        storage_path: contract.storage_path,
                        bucket:       contract.bucket,
                        is_active:    contract.is_active,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden sm:block rounded-lg border bg-card overflow-x-auto">
              <table className="w-full text-sm min-w-[600px]">
                <thead>
                  <tr className="border-b bg-muted/30">
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Description</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Uploaded</th>
                    <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {rows.map((contract) => (
                    <tr key={contract.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{contract.name}</td>
                      <td className="px-4 py-3 text-muted-foreground max-w-xs">
                        {contract.description ? (
                          <span className="line-clamp-2">{contract.description}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={contract.is_active ? "default" : "secondary"}>
                          {contract.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDate(contract.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <SendContractDialog
                            contract={{ id: contract.id, name: contract.name }}
                            customers={(customers ?? []) as { id: string; name: string; email: string | null }[]}
                            templates={(templates ?? []) as { id: string; name: string; subject: string | null; body: string }[]}
                            companySettings={companySettings ?? null}
                            userId={user.id}
                          />
                          <ContractActions
                            contract={{
                              id:           contract.id,
                              name:         contract.name,
                              storage_path: contract.storage_path,
                              bucket:       contract.bucket,
                              is_active:    contract.is_active,
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Sent contracts tracking */}
        {(sentContracts ?? []).length > 0 && (
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Sent Contracts</h2>
            <SentContractsTable
              sent={(sentContracts ?? []) as any}
              appUrl={appUrl}
            />
          </div>
        )}
      </div>
    </div>
  )
}
