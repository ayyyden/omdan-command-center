import type { SupabaseClient } from "@supabase/supabase-js"

// Resolves the CRM user_id to attribute unattended/service-triggered
// assistant actions to (Lia's execute route, scheduled bank sync, ...).
// Priority: ASSISTANT_OWNER_EMAIL env var → active owner role fallback.
// Shared by every server-to-server caller that needs "who is this on behalf
// of" without a real browser session.
export async function resolveAssistantOwnerUserId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
): Promise<{ userId: string | null; error: string | null }> {
  const ownerEmail = process.env.ASSISTANT_OWNER_EMAIL
  if (ownerEmail) {
    const { data: byEmail, error: emailErr } = await supabase
      .from("team_members")
      .select("user_id, role")
      .ilike("email", ownerEmail)
      .not("user_id", "is", null)
      .single()
    if (emailErr) {
      console.error("[assistant-owner] lookup by ASSISTANT_OWNER_EMAIL failed:", emailErr.message)
    }
    if (byEmail?.user_id && ["owner", "admin"].includes(byEmail.role)) {
      return { userId: byEmail.user_id as string, error: null }
    }
    if (byEmail?.user_id) {
      return { userId: null, error: "Configured ASSISTANT_OWNER_EMAIL is not an owner or admin" }
    }
  }

  const { data: byRole, error: roleErr } = await supabase
    .from("team_members")
    .select("user_id")
    .eq("role", "owner")
    .eq("status", "active")
    .not("user_id", "is", null)
    .single()
  if (roleErr) {
    console.error("[assistant-owner] owner fallback lookup failed:", roleErr.message, roleErr.details)
  }
  const userId = (byRole?.user_id as string) ?? null
  if (!userId) {
    return { userId: null, error: "Owner not found. Set ASSISTANT_OWNER_EMAIL in Vercel env vars to the owner's email address." }
  }
  return { userId, error: null }
}
