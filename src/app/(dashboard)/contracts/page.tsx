import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Badge } from "@/components/ui/badge"
import { UploadContractDialog } from "@/components/contracts/upload-contract-dialog"
import { ContractActions } from "@/components/contracts/contract-actions"
import { SentContractsTable } from "@/components/contracts/sent-contracts-table"
import { DocumentsList } from "@/components/contracts/documents-list"
import { ManageTemplatesToggle } from "@/components/contracts/manage-templates-toggle"
import { formatDate } from "@/lib/utils"

export default async function ContractsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const [
    { data: templates },
    { data: companySettings },
    { data: sentContracts },
  ] = await Promise.all([
    supabase
      .from("contract_templates")
      .select("*")
      .order("created_at", { ascending: false }),
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

  const rows = templates ?? []
  const activeCount = rows.filter((c) => c.is_active).length
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ""

  const pairedIds = new Set(rows.map((t) => t.attached_to_template_id).filter(Boolean) as string[])
  const pairedChildByParent = new Map(
    rows.filter((t) => t.attached_to_template_id).map((t) => [t.attached_to_template_id as string, t.id])
  )
  const documents = rows
    .filter((t) => t.is_active && !t.attached_to_template_id)
    .map((t) => ({
      id: t.id,
      name: t.name,
      requiresSignature: t.requires_signature,
      hasPairedDoc: pairedIds.has(t.id),
      pairedTemplateId: pairedChildByParent.get(t.id) ?? null,
    }))

  return (
    <div>
      <Topbar
        title="Documents"
        subtitle={`${documents.length} document${documents.length !== 1 ? "s" : ""} available · ${rows.length} template${rows.length !== 1 ? "s" : ""} total`}
        actions={<UploadContractDialog userId={user.id} existingTemplates={rows.map((t) => ({ id: t.id, name: t.name }))} />}
      />

      <div className="p-4 sm:p-6 space-y-8">
        <DocumentsList
          documents={documents}
          userId={user.id}
          companyName={companySettings?.company_name ?? null}
        />

        <ManageTemplatesToggle>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">No templates uploaded yet.</p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="sm:hidden space-y-3">
                {rows.map((contract) => (
                  <div key={contract.id} className="rounded-lg border bg-card p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">{contract.name}</p>
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        <Badge variant={contract.is_active ? "default" : "secondary"}>
                          {contract.is_active ? "Active" : "Inactive"}
                        </Badge>
                        {contract.attached_to_template_id && (
                          <Badge variant="outline" className="text-[10px]">Paired doc</Badge>
                        )}
                      </div>
                    </div>
                    {contract.description && (
                      <p className="text-sm text-muted-foreground leading-snug">{contract.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground">Uploaded {formatDate(contract.created_at)}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
                      <ContractActions
                        contract={{
                          id: contract.id, name: contract.name, storage_path: contract.storage_path,
                          bucket: contract.bucket, is_active: contract.is_active,
                          requires_signature: contract.requires_signature,
                          attached_to_template_id: contract.attached_to_template_id,
                        }}
                        otherTemplates={rows.filter((t) => t.id !== contract.id).map((t) => ({ id: t.id, name: t.name }))}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden sm:block rounded-lg border bg-card overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Uploaded</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {rows.map((contract) => (
                      <tr key={contract.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          {contract.name}
                          {contract.attached_to_template_id && (
                            <Badge variant="outline" className="ml-2 text-[10px] align-middle">Paired doc</Badge>
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
                          <ContractActions
                            contract={{
                              id: contract.id, name: contract.name, storage_path: contract.storage_path,
                              bucket: contract.bucket, is_active: contract.is_active,
                              requires_signature: contract.requires_signature,
                              attached_to_template_id: contract.attached_to_template_id,
                            }}
                            otherTemplates={rows.filter((t) => t.id !== contract.id).map((t) => ({ id: t.id, name: t.name }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </ManageTemplatesToggle>

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
