import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { LiaChat } from "@/components/assistant/lia-chat"

interface Props {
  searchParams: Promise<{ conv?: string }>
}

export const metadata = { title: "Lia AI | Omdan Command Center" }

export default async function LiaPage({ searchParams }: Props) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Permission check
  const { data: member } = await supabase
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .single()

  if (!member || member.status !== "active" || !can(member.role as TeamRole, "lia:chat")) {
    redirect("/dashboard")
  }

  const { conv: convParam } = await searchParams
  let conversationId = convParam

  if (!conversationId) {
    // Find or create a conversation
    const { data: recent } = await supabase
      .from("assistant_conversations")
      .select("id")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single()

    if (recent?.id) {
      conversationId = recent.id
    } else {
      const { data: newConv } = await supabase
        .from("assistant_conversations")
        .insert({ user_id: user.id })
        .select("id")
        .single()
      conversationId = newConv?.id ?? undefined
    }
  }

  if (!conversationId) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Could not start a conversation. Please refresh.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto w-full">
      <LiaChat conversationId={conversationId} />
    </div>
  )
}
