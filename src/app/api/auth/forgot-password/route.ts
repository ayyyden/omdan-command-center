import { NextRequest, NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/service"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"
import { appBaseUrl } from "@/lib/estimate-delivery"

// POST /api/auth/forgot-password { email } — public (login page).
// Emails an active team member a link to /reset-password where they choose a
// new password. The link carries a one-time Supabase recovery token (valid
// about an hour) that is only used when they press "Save new password", so an
// email scanner opening the link can't use it up. The answer is always the
// same, so nobody can use this to find out which emails have an account.
export async function POST(req: NextRequest) {
  const { email: raw } = (await req.json().catch(() => ({}))) as { email?: string }
  const email = String(raw ?? "").trim().toLowerCase()
  const done = NextResponse.json({ ok: true })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return done
  if (!smtpConfigured()) return NextResponse.json({ error: "Email isn't set up on the server" }, { status: 500 })

  const service = createServiceClient()
  const { data: member } = await service.from("team_members").select("name, email, status").ilike("email", email).eq("status", "active").maybeSingle()
  if (!member) return done

  const { data, error } = await service.auth.admin.generateLink({ type: "recovery", email: member.email })
  const token = data?.properties?.hashed_token
  if (error || !token) {
    console.error("[forgot-password] couldn't create the reset link:", error?.message)
    return done
  }

  const link = `${appBaseUrl(req.nextUrl.origin)}/reset-password?token=${encodeURIComponent(token)}`
  const name = (member.name ?? "").trim()
  try {
    await createTransporter().sendMail({
      from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to:      member.email,
      subject: "Reset your Omdan Command Center password",
      text:    `Hi${name ? ` ${name}` : ""},\n\nSomeone asked to reset the password for your Omdan Command Center account. Open this link to choose a new password (it works for about an hour):\n\n${link}\n\nIf this wasn't you, you can ignore this email. Your password stays the same.`,
      html:    buildHtmlEmail({
        title:       "Reset your password",
        preheader:   "Choose a new password for the Omdan Command Center",
        companyName: "Omdan Development",
        bodyLines: [
          `Hi${name ? ` ${name}` : ""},`,
          "",
          "Someone asked to reset the password for your Omdan Command Center account. Press the button to choose a new password. The link works for about an hour.",
          "",
          "If this wasn't you, you can ignore this email. Your password stays the same.",
        ],
        ctaLabel: "Choose a new password",
        ctaUrl:   link,
      }),
    })
  } catch (err) {
    console.error("[forgot-password] email failed:", err)
    return NextResponse.json({ error: "Couldn't send the email. Try again in a minute." }, { status: 502 })
  }
  return done
}
