import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { MessageTemplateForm } from "@/components/settings/message-template-form"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

export default async function NewMessageTemplatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: member } = await supabase
    .from("team_members")
    .select("role")
    .eq("user_id", user.id)
    .single()

  if (!member || !can(member.role as TeamRole, "settings:templates")) {
    redirect("/settings")
  }

  return (
    <div>
      <Topbar title="New Template" subtitle="Create a message template" />
      <div className="p-4 sm:p-6">
        <MessageTemplateForm userId={user.id} />
      </div>
    </div>
  )
}
