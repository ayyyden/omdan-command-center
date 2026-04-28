import { createServiceClient } from "@/lib/supabase/service"
import { notFound } from "next/navigation"
import { AcceptInviteForm } from "./accept-invite-form"
import { ROLE_LABELS } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { Users } from "lucide-react"
import Link from "next/link"

interface PageProps {
  params: Promise<{ token: string }>
}

export default async function InvitePage({ params }: PageProps) {
  const { token } = await params
  const service = createServiceClient()

  const [{ data: invite }, { data: cs }] = await Promise.all([
    service
      .from("team_members")
      .select("id, email, name, role, status, invite_expires_at")
      .eq("invite_token", token)
      .single(),
    service
      .from("company_settings")
      .select("logo_url")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!invite) notFound()

  const isExpired = invite.invite_expires_at
    ? new Date(invite.invite_expires_at) < new Date()
    : false
  const isUsed = invite.status !== "invited"
  const invalid = isExpired || isUsed
  const logoUrl = cs?.logo_url ?? null

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm space-y-6">
        {/* Brand */}
        <div className="text-center">
          <div className="flex justify-center mb-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="Logo" className="w-16 h-16 object-contain" />
            ) : (
              <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-primary">
                <Users className="w-7 h-7 text-primary-foreground" />
              </div>
            )}
          </div>
          <h1 className="text-2xl font-bold">Omdan Command Center</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {invalid ? "Invitation unavailable" : "You've been invited to join the team"}
          </p>
        </div>

        {invalid ? (
          <div className="rounded-xl border bg-card p-6 text-center space-y-3">
            <p className="font-semibold text-sm">
              {isUsed ? "Invite Already Used" : "Invite Expired"}
            </p>
            <p className="text-sm text-muted-foreground">
              {isUsed
                ? "This invitation has already been accepted."
                : "This invite link has expired. Ask an admin to resend the invitation."}
            </p>
            <Link href="/login" className="text-sm text-primary hover:underline">
              Go to sign in →
            </Link>
          </div>
        ) : (
          <AcceptInviteForm
            token={token}
            email={invite.email}
            name={invite.name}
            roleLabel={ROLE_LABELS[invite.role as TeamRole] ?? invite.role}
          />
        )}
      </div>
    </div>
  )
}
