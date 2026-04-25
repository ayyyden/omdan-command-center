import { createClient } from "@/lib/supabase/server"
import { Topbar } from "@/components/shared/topbar"
import { MessageTemplateForm } from "@/components/settings/message-template-form"

export default async function NewMessageTemplatePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  return (
    <div>
      <Topbar title="New Template" subtitle="Create a message template" />
      <div className="p-4 sm:p-6">
        <MessageTemplateForm userId={user.id} />
      </div>
    </div>
  )
}
