import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/service"
import { v4 as uuidv4 } from "uuid"
import nodemailer from "nodemailer"

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { data: invoker } = await supabase
      .from("team_members").select("role, status").eq("user_id", user.id).single()

    if (!invoker || invoker.status !== "active" || !["owner", "admin"].includes(invoker.role)) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 })
    }

    const service = createServiceClient()
    const { data: target } = await service
      .from("team_members").select("id, email, name, role, status").eq("id", id).single()

    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 })
    if (target.status !== "invited") return NextResponse.json({ error: "Invite already accepted" }, { status: 400 })

    const token = uuidv4()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: dbError } = await service
      .from("team_members")
      .update({ invite_token: token, invite_expires_at: expiresAt })
      .eq("id", id)

    if (dbError) {
      return NextResponse.json({ error: "Failed to refresh invite token" }, { status: 500 })
    }

    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/invite/${token}`
    const roleLabel = (target.role as string).replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST ?? "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })

      await transporter.sendMail({
        from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
        to: target.email,
        subject: "Reminder: Your Omdan Command Center invite",
        html: `
          <div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;padding:24px;">
            <h2 style="color:#111;">Reminder: You've been invited</h2>
            <p style="color:#555;">Hi ${target.name}, your invite as a <strong>${roleLabel}</strong> is still waiting.</p>
            <p style="color:#555;">This new link expires in 7 days.</p>
            <a href="${inviteUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;margin:16px 0;">
              Accept Invitation →
            </a>
            <p style="color:#888;font-size:13px;">${inviteUrl}</p>
          </div>
        `,
      })
    } catch (err) {
      console.error("Resend email failed:", err)
      return NextResponse.json({
        ok: true,
        warning: "Token refreshed but email failed to send. Copy the link and share it manually.",
        inviteUrl,
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("Resend route error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
