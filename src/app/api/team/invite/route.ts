import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { canInviteRole } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { v4 as uuidv4 } from "uuid"
import nodemailer from "nodemailer"

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { data: invoker } = await supabase
    .from("team_members")
    .select("role, status")
    .eq("user_id", user.id)
    .single()

  if (!invoker || invoker.status !== "active" || !["owner", "admin"].includes(invoker.role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
  }

  const body = await req.json()
  const { email, name, role } = body as { email: string; name: string; role: TeamRole }

  if (!email || !name || !role) {
    return NextResponse.json({ error: "email, name, and role are required" }, { status: 400 })
  }

  if (!canInviteRole(invoker.role as TeamRole, role)) {
    return NextResponse.json({ error: "Cannot invite a member with a higher role than your own" }, { status: 403 })
  }

  const service = createServiceClient()

  // Check if email already exists
  const { data: existing } = await service
    .from("team_members")
    .select("id, status")
    .ilike("email", email)
    .maybeSingle()

  if (existing?.status === "active") {
    return NextResponse.json({ error: "A team member with this email is already active" }, { status: 409 })
  }

  const token = uuidv4()
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/invite/${token}`

  let dbError: unknown
  if (existing) {
    const { error } = await service
      .from("team_members")
      .update({ name, role, status: "invited", invite_token: token, invite_expires_at: expiresAt, invited_by: user.id })
      .eq("id", existing.id)
    dbError = error
  } else {
    const { error } = await service
      .from("team_members")
      .insert({ email: email.toLowerCase().trim(), name, role, status: "invited", invited_by: user.id, invite_token: token, invite_expires_at: expiresAt })
    dbError = error
  }

  if (dbError) {
    const msg = (dbError as any).message ?? "Database error"
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST ?? "smtp.gmail.com",
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })

    const roleLabel = role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())

    await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: email,
      subject: "You've been invited to Omdan Command Center",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;background:#fff;border-radius:8px;">
          <h2 style="color:#111;margin-bottom:4px;">You've been invited</h2>
          <p style="color:#555;margin-top:0;">Hi ${name},</p>
          <p style="color:#555;">You've been invited to join the <strong>Omdan Command Center</strong> as a <strong>${roleLabel}</strong>.</p>
          <p style="color:#555;">Click the button below to set up your account. This invite expires in 7 days.</p>
          <a href="${inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">
            Accept Invitation →
          </a>
          <p style="color:#888;font-size:13px;">Or paste this link in your browser:<br/>${inviteUrl}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;"/>
          <p style="color:#aaa;font-size:12px;">If you weren't expecting this, you can safely ignore this email.</p>
        </div>
      `,
    })
  } catch (err) {
    console.error("Invite email failed:", err)
    return NextResponse.json({ ok: true, warning: "Invite created but email failed to send. Share this link manually.", inviteUrl })
  }

  return NextResponse.json({ ok: true })
}
