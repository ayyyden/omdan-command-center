import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"

export async function POST(req: Request) {
  const body = await req.json()
  const { token, password } = body as { token?: string; password?: string }

  if (!token || !password) {
    return NextResponse.json({ error: "token and password are required" }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 })
  }

  const service = createServiceClient()

  const { data: invite } = await service
    .from("team_members")
    .select("id, email, name, status, invite_expires_at")
    .eq("invite_token", token)
    .single()

  if (!invite) {
    return NextResponse.json({ error: "Invalid or expired invite link" }, { status: 400 })
  }
  if (invite.status !== "invited") {
    return NextResponse.json({ error: "This invitation has already been used. Try signing in." }, { status: 400 })
  }
  if (invite.invite_expires_at && new Date(invite.invite_expires_at) < new Date()) {
    return NextResponse.json({ error: "This invite has expired. Ask an admin to resend it." }, { status: 400 })
  }

  // Try to create Supabase auth user (admin API, auto-confirms email)
  const { data: authData, error: authError } = await service.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { name: invite.name },
  })

  let authUserId: string | null = authData?.user?.id ?? null

  if (authError && !authUserId) {
    const alreadyExists =
      authError.message?.toLowerCase().includes("already registered") ||
      authError.message?.toLowerCase().includes("already been registered") ||
      authError.message?.toLowerCase().includes("user already exists")

    if (!alreadyExists) {
      return NextResponse.json({ error: authError.message ?? "Failed to create account" }, { status: 500 })
    }

    // Find the existing auth user by email via listUsers (paginated)
    let page = 1
    outer: while (true) {
      const { data: { users }, error: listErr } = await service.auth.admin.listUsers({ page, perPage: 1000 })
      if (listErr || !users) break
      for (const u of users) {
        if (u.email?.toLowerCase() === invite.email.toLowerCase()) {
          authUserId = u.id
          break outer
        }
      }
      if (users.length < 1000) break
      page++
    }

    if (!authUserId) {
      return NextResponse.json({ error: "An account with this email exists but could not be linked. Contact your administrator." }, { status: 409 })
    }

    // Update the existing user's password so they can log in with what they just set
    const { error: pwErr } = await service.auth.admin.updateUserById(authUserId, { password })
    if (pwErr) {
      console.error("Failed to update password for existing user:", pwErr)
      // Non-fatal: still link them, they can use their old password
    }
  }

  if (!authUserId) {
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 })
  }

  // Link auth user to team_members row
  const { error: updateError } = await service
    .from("team_members")
    .update({ user_id: authUserId, status: "active", invite_token: null, invite_expires_at: null })
    .eq("id", invite.id)

  if (updateError) {
    // Only rollback if we created a brand-new user (not an existing one)
    if (authData?.user) {
      await service.auth.admin.deleteUser(authUserId)
    }
    return NextResponse.json({ error: "Failed to activate account. Please try again." }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
