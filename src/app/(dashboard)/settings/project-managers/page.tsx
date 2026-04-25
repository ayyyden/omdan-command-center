import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { PMFormDialog, TogglePMButton, ArchivePMButton, DeletePMButton } from "@/components/settings/pm-form"
import { Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import type { ProjectManager } from "@/types"

interface PageProps {
  searchParams: Promise<{ archived?: string }>
}

export default async function ProjectManagersPage({ searchParams }: PageProps) {
  const { archived } = await searchParams
  const isArchived = archived === "true"

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: pms } = await supabase
    .from("project_managers")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_archived", isArchived)
    .order("name")

  const managers = (pms ?? []) as ProjectManager[]

  return (
    <div>
      <Topbar
        title="Project Managers"
        subtitle={`${managers.length}${isArchived ? " archived" : " total"}`}
        actions={!isArchived ? <PMFormDialog userId={user.id} /> : undefined}
      />

      <div className="p-6 space-y-4">
        {/* Archived toggle */}
        <div className="flex gap-2">
          <Link href="/settings/project-managers">
            <Badge variant={!isArchived ? "default" : "outline"} className="cursor-pointer">Active</Badge>
          </Link>
          <Link href="/settings/project-managers?archived=true">
            <Badge variant={isArchived ? "default" : "outline"} className="cursor-pointer">Archived</Badge>
          </Link>
        </div>

        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-[180px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {managers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-12">
                    {isArchived ? "No archived project managers." : "No project managers yet. Add your first one above."}
                  </TableCell>
                </TableRow>
              ) : (
                managers.map((pm) => (
                  <TableRow key={pm.id} className={(!pm.is_active || isArchived) ? "opacity-60" : ""}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                        <span className="font-medium">{pm.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{pm.phone ?? "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{pm.email ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={pm.is_active ? "success" : "muted"}>
                        {pm.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!isArchived && (
                          <>
                            <PMFormDialog
                              pm={pm}
                              userId={user.id}
                              trigger={
                                <Button variant="ghost" size="sm" title="Edit">
                                  <Pencil className="w-4 h-4" />
                                </Button>
                              }
                            />
                            <TogglePMButton pmId={pm.id} pmName={pm.name} isActive={pm.is_active} />
                          </>
                        )}
                        <ArchivePMButton pmId={pm.id} pmName={pm.name} isArchived={isArchived} />
                        <DeletePMButton pmId={pm.id} pmName={pm.name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
