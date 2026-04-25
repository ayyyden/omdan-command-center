import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { TEMPLATE_TYPE_LABELS, ToggleTemplateButton, DeleteTemplateButton } from "@/components/settings/message-template-form"
import { Pencil, Plus } from "lucide-react"
import Link from "next/link"
import type { MessageTemplate } from "@/types"

export default async function MessageTemplatesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: templates } = await supabase
    .from("message_templates")
    .select("*")
    .eq("user_id", user.id)
    .order("type")
    .order("name")

  const rows = (templates ?? []) as MessageTemplate[]

  return (
    <div>
      <Topbar
        title="Message Templates"
        subtitle={`${rows.length} template${rows.length !== 1 ? "s" : ""}`}
        actions={
          <Link href="/settings/message-templates/new">
            <Button size="sm" className="gap-1.5">
              <Plus className="w-4 h-4" />
              New Template
            </Button>
          </Link>
        }
      />

      <div className="p-6">
        {rows.length === 0 ? (
          <div className="rounded-lg border bg-card flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-muted-foreground">No templates yet.</p>
            <Link href="/settings/message-templates/new">
              <Button size="sm" variant="outline" className="gap-1.5">
                <Plus className="w-4 h-4" />
                Create your first template
              </Button>
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[160px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={t.id} className={t.is_active ? "" : "opacity-60"}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {TEMPLATE_TYPE_LABELS[t.type] ?? t.type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {t.subject ?? <span className="italic text-muted-foreground/60">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={t.is_active ? "success" : "muted"}>
                        {t.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Link href={`/settings/message-templates/${t.id}`}>
                          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                            <Pencil className="w-3 h-3" />
                            Edit
                          </Button>
                        </Link>
                        <ToggleTemplateButton id={t.id} isActive={t.is_active} />
                        <DeleteTemplateButton id={t.id} name={t.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
