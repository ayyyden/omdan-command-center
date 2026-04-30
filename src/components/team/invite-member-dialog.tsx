"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { Loader2, UserPlus } from "lucide-react"
import { ROLES, ROLE_LABELS, canInviteRole } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

interface Props {
  currentUserRole: TeamRole
}

export function InviteMemberDialog({ currentUserRole }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [role, setRole] = useState<TeamRole>("project_manager")
  const [loading, setLoading] = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)

  const invitableRoles = ROLES.filter((r) => canInviteRole(currentUserRole, r))

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setInviteUrl(null)
    try {
      const res = await fetch("/api/team/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, role }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Failed to send invite", description: data.error, variant: "destructive" })
        return
      }
      if (data.warning) {
        setInviteUrl(data.inviteUrl)
        toast({ title: "Invite created", description: data.warning })
      } else {
        toast({ title: "Invite sent", description: `${name} will receive an email at ${email}` })
        setEmail(""); setName(""); setRole("project_manager")
        setOpen(false)
        router.refresh()
      }
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setInviteUrl(null) } }}>
      <DialogTrigger asChild>
        <Button size="sm">
          <UserPlus className="w-4 h-4 mr-2" />Invite Member
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Invite Team Member</DialogTitle></DialogHeader>

        {inviteUrl ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Email failed to send. Share this link manually:</p>
            <div className="rounded-md border bg-muted/40 p-3 text-xs break-all font-mono select-all">
              {inviteUrl}
            </div>
            <Button className="w-full" onClick={() => { navigator.clipboard.writeText(inviteUrl); toast({ title: "Copied!" }) }}>
              Copy Link
            </Button>
          </div>
        ) : (
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="inv-name">Full name</Label>
              <Input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Smith" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-email">Email</Label>
              <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@example.com" required />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as TeamRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {invitableRoles.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter className="gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}Send Invite
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
