import { NextRequest } from "next/server"
import { requirePermission, hasJobScope } from "@/lib/auth-helpers"
import { createTransporter, buildHtmlEmail, smtpConfigured } from "@/lib/email"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const session = await requirePermission("jobs:update_status")
  if (session instanceof Response) return session
  const { userId, role, pmId, supabase } = session

  const { to, subject, body } = await req.json() as {
    to: string
    subject: string
    body: string
  }

  if (!to || !subject || !body) {
    return Response.json({ error: "Missing required fields" }, { status: 400 })
  }

  // PM scope enforcement
  if (hasJobScope(role)) {
    const { data: ownership } = await supabase
      .from("jobs")
      .select("project_manager_id")
      .eq("id", id)
      .single()
    if (!ownership || ownership.project_manager_id !== pmId) {
      return Response.json({ error: "Forbidden" }, { status: 403 })
    }
  }

  const [{ data: job }, { data: company }] = await Promise.all([
    supabase
      .from("jobs")
      .select("customer_id, customer:customers(id, name)")
      .eq("id", id)
      .single(),
    supabase
      .from("company_settings")
      .select("company_name, google_review_link")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (!job) return Response.json({ error: "Not found" }, { status: 404 })

  if (!smtpConfigured()) {
    return Response.json({ error: "SMTP credentials not configured" }, { status: 500 })
  }

  const companyName = company?.company_name ?? "Us"
  const googleReviewLink = company?.google_review_link ?? null

  const htmlBody = buildHtmlEmail({
    title: subject,
    preheader: body.split("\n")[0],
    companyName,
    bodyLines: body.split("\n"),
    ctaLabel: googleReviewLink ? "Leave Us a Google Review" : undefined,
    ctaUrl:   googleReviewLink ?? undefined,
  })

  const transporter = createTransporter()
  await transporter.sendMail({
    from:    process.env.SMTP_FROM ?? process.env.SMTP_USER,
    to,
    subject,
    text:    googleReviewLink ? `${body}\n\nLeave us a Google Review: ${googleReviewLink}` : body,
    html:    htmlBody,
  })

  // Mark review as requested if not already
  const now = new Date().toISOString()
  await supabase
    .from("jobs")
    .update({ review_requested_at: now })
    .eq("id", id)
    .is("review_requested_at", null)

  // Log communication
  await supabase.from("communication_logs").insert({
    user_id:     userId,
    customer_id: job.customer_id,
    job_id:      id,
    type:        "review_request",
    subject,
    body,
    channel:     "email",
  })

  return Response.json({ success: true, review_requested_at: now })
}
