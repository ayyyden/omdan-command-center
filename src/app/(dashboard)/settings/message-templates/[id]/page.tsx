import { notFound, redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { MessageTemplateForm } from "@/components/settings/message-template-form"
import type { MessageTemplate } from "@/types"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditMessageTemplatePage({ params }: PageProps) {
  const { id } = await params
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

  const { data: template } = await supabase
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .single()

  if (!template) notFound()

  return (
    <div>
      <Topbar title="Edit Template" subtitle={(template as MessageTemplate).name} />
      <div className="p-4 sm:p-6">
        <MessageTemplateForm userId={user.id} template={template as MessageTemplate} />
      </div>
    </div>
  )
}
