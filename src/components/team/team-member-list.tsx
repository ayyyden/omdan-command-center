"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
  MoreHorizontal, Loader2, RefreshCw, ShieldCheck, UserX, UserCheck, Trash2, Copy, ChevronRight, BarChart2,
} from "lucide-react"
import { RoleBadge } from "@/components/team/role-badge"
import { InviteMemberDialog } from "@/components/team/invite-member-dialog"
import { canManageRole, ACTIVE_ROLES, ROLE_LABELS } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import Link from "next/link"

interface TeamMember {
  id: string
  user_id: string | null
  email: string
  name: string
  role: string
  status: string
  created_at: string
  invite_expires_at: string | null
  invite_token: string | null
  project_manager_id: string | null
}

interface ProjectManager {
  id: string
  name: string
}

interface Props {
  members: TeamMember[]
  currentUserId: string
  currentUserRole: TeamRole
  projectManagers: ProjectManager[]
  canViewPerformance: boolean
}

export function TeamMemberList({ members, currentUserId, currentUserRole, projectManagers, canViewPerformance }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [changeRoleTarget, setChangeRoleTarget] = useState<TeamMember | null>(null)
  const [newRole, setNewRole] = useState<TeamRole>("project_manager")
  const [newPmId, setNewPmId] = useState<string>("none")
  const [deleteTarget, setDeleteTarget] = useState<TeamMember | null>(null)

  async function safeJson(res: Response): Promise<Record<string, unknown>> {
    const ct = res.headers.get("content-type") ?? ""
    if (ct.includes("application/json")) {
      return res.json().catch(() => ({}))
    }
    return {}
  }

  async function api(method: string, url: string, body?: object) {
    return fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async function withBusy(id: string, fn: () => Promise<void>) {
    setBusy(id)
    try {
      await fn()
    } catch {
      toast({ title: "Unexpected error. Please try again.", variant: "destructive" })
    } finally {
      setBusy(null)
    }
  }

  async function handleStatus(member: TeamMember, status: "active" | "disabled") {
    await withBusy(member.id, async () => {
      const res = await api("PATCH", `/api/team/members/${member.id}`, { status })
      const data = await safeJson(res)
      if (!res.ok) { toast({ title: "Error", description: data.error as string, variant: "destructive" }); return }
      toast({ title: status === "active" ? "Member reactivated" : "Member disabled" })
      router.refresh()
    })
  }

  async function handleRoleChange() {
    if (!changeRoleTarget) return
    const id = changeRoleTarget.id
    const roleNeedsScope = newRole === "project_manager"
    const pmId = roleNeedsScope && newPmId !== "none" ? newPmId : null
    setChangeRoleTarget(null)
    await withBusy(id, async () => {
      const body: Record<string, unknown> = { role: newRole }
      if (roleNeedsScope) body.project_manager_id = pmId
      const res = await api("PATCH", `/api/team/members/${id}`, body)
      const data = await safeJson(res)
      if (!res.ok) { toast({ title: "Error", description: data.error as string, variant: "destructive" }); return }
      toast({ title: "Role updated" })
      router.refresh()
    })
  }

  async function handleDelete(member: TeamMember) {
    const id = member.id
    setDeleteTarget(null)
    await withBusy(id, async () => {
      const res = await api("DELETE", `/api/team/members/${id}`)
      const data = await safeJson(res)
      if (!res.ok) { toast({ title: "Error", description: data.error as string, variant: "destructive" }); return }
      const n = (data.affectedJobs as number) ?? 0
      toast({
        title: "Member removed",
        description: n > 0
          ? `${n} open job${n === 1 ? "" : "s"} no longer have a PM — go to Jobs to assign new ones.`
          : undefined,
      })
      router.refresh()
    })
  }

  async function handleResend(member: TeamMember) {
    await withBusy(member.id, async () => {
      const res = await api("POST", `/api/team/resend/${member.id}`)
      const data = await safeJson(res)
      if (!res.ok) { toast({ title: "Error", description: (data.error as string) ?? "Failed to resend", variant: "destructive" }); return }
      if (data.warning) {
        toast({ title: "Token refreshed", description: data.warning as string })
      } else {
        toast({ title: "Invite resent" })
      }
      router.refresh()
    })
  }

  function copyInviteLink(token: string) {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: "Invite link copied!" })
    }).catch(() => {
      toast({ title: "Could not copy", description: url, variant: "destructive" })
    })
  }

  const assignableRoles = ACTIVE_ROLES.filter((r) => canManageRole(currentUserRole, r))

  return (
    <>
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {members.length} member{members.length !== 1 ? "s" : ""}
        </p>
        <InviteMemberDialog currentUserRole={currentUserRole} />
      </div>

      {/* Member cards */}
      <div className="space-y-2">
        {members.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No team members yet.</p>
        )}
        {members.map((member) => {
          const isSelf = member.user_id === currentUserId
          const canManage = canManageRole(currentUserRole, member.role as TeamRole) && !isSelf
          const isLoading = busy === member.id

          const perfHref = `/settings/team/${member.id}`

          return (
            <Card key={member.id} className={canViewPerformance && !isSelf ? "cursor-pointer hover:bg-accent/40 transition-colors" : undefined}>
              <CardContent className="py-3 px-4">
                <div className="flex items-center gap-3">
                  {/* Avatar initials */}
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-bold shrink-0 text-muted-foreground uppercase">
                    {member.name.charAt(0)}
                  </div>

                  {/* Name + email — clickable area for admin/owner */}
                  {canViewPerformance && !isSelf ? (
                    <Link href={perfHref} className="flex-1 min-w-0 group">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold group-hover:underline">{member.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      {member.role === "project_manager" && (
                        <p className="text-xs text-muted-foreground/70 truncate">
                          {member.project_manager_id
                            ? `PM: ${projectManagers.find(p => p.id === member.project_manager_id)?.name ?? "Unknown"}`
                            : "No PM linked — no job access"}
                        </p>
                      )}
                    </Link>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-semibold">{member.name}</span>
                        {isSelf && (
                          <span className="text-xs text-muted-foreground">(you)</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                      {member.role === "project_manager" && (
                        <p className="text-xs text-muted-foreground/70 truncate">
                          {member.project_manager_id
                            ? `PM: ${projectManagers.find(p => p.id === member.project_manager_id)?.name ?? "Unknown"}`
                            : "No PM linked — no job access"}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Badges + action */}
                  <div className="flex items-center gap-2 shrink-0">
                    <RoleBadge role={member.role} />
                    <StatusDot status={member.status} />
                    {canViewPerformance && !isSelf && !canManage && (
                      <ChevronRight className="w-4 h-4 text-muted-foreground" />
                    )}
                    {canManage && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isLoading}>
                            {isLoading
                              ? <Loader2 className="w-4 h-4 animate-spin" />
                              : <MoreHorizontal className="w-4 h-4" />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onSelect={() => router.push(perfHref)}>
                            <BarChart2 className="w-4 h-4 mr-2" />View Performance
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => { setChangeRoleTarget(member); setNewRole(member.role as TeamRole); setNewPmId(member.project_manager_id ?? "none") }}>
                            <ShieldCheck className="w-4 h-4 mr-2" />Change Role
                          </DropdownMenuItem>
                          {member.status === "invited" && (
                            <DropdownMenuItem onSelect={() => handleResend(member)}>
                              <RefreshCw className="w-4 h-4 mr-2" />Resend Invite
                            </DropdownMenuItem>
                          )}
                          {member.status === "invited" && member.invite_token && (
                            <DropdownMenuItem onSelect={() => copyInviteLink(member.invite_token!)}>
                              <Copy className="w-4 h-4 mr-2" />Copy Invite Link
                            </DropdownMenuItem>
                          )}
                          {member.status === "active" && (
                            <DropdownMenuItem onSelect={() => handleStatus(member, "disabled")}>
                              <UserX className="w-4 h-4 mr-2" />Disable Access
                            </DropdownMenuItem>
                          )}
                          {member.status === "disabled" && (
                            <DropdownMenuItem onSelect={() => handleStatus(member, "active")}>
                              <UserCheck className="w-4 h-4 mr-2" />Reactivate
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => setDeleteTarget(member)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="w-4 h-4 mr-2" />Remove from Team
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>

                {/* Pending invite note */}
                {member.status === "invited" && (
                  <div className="mt-1.5 ml-12 flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">
                      Invite pending
                      {member.invite_expires_at && (
                        <> · expires {new Date(member.invite_expires_at).toLocaleDateString()}</>
                      )}
                    </p>
                    {member.invite_token && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => copyInviteLink(member.invite_token!)}
                      >
                        <Copy className="w-3 h-3" />Copy link
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Change Role dialog */}
      <Dialog open={!!changeRoleTarget} onOpenChange={(v) => !v && setChangeRoleTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Change Role</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            For <span className="font-semibold text-foreground">{changeRoleTarget?.name}</span>
          </p>
          <Select value={newRole} onValueChange={(v) => setNewRole(v as TeamRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {assignableRoles.map((r) => (
                <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {newRole === "project_manager" && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Linked Project Manager</p>
              <Select value={newPmId} onValueChange={setNewPmId}>
                <SelectTrigger><SelectValue placeholder="None — sees no jobs" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None — sees no jobs</SelectItem>
                  {projectManagers.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>{pm.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Job filtering uses this PM&apos;s assignment.</p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setChangeRoleTarget(null)}>Cancel</Button>
            <Button onClick={handleRoleChange} disabled={!!busy}>
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Remove Team Member?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{deleteTarget?.name}</span> will immediately
            lose all access.{deleteTarget?.status === "invited" ? " The invite link will stop working." : ""}
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
              disabled={!!busy}
            >
              {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function StatusDot({ status }: { status: string }) {
  if (status === "active") {
    return <span className="text-xs font-medium text-success">Active</span>
  }
  if (status === "invited") {
    return <span className="text-xs font-medium text-warning">Pending</span>
  }
  return <span className="text-xs font-medium text-muted-foreground">Disabled</span>
}
