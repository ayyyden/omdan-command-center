import nodemailer from "nodemailer"

export function createTransporter() {
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST ?? "smtp.gmail.com",
    port:   Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })
}

export function buildHtmlEmail(opts: {
  title: string
  preheader?: string
  companyName: string
  bodyLines: string[]
  ctaLabel?: string
  ctaUrl?: string
}): string {
  const { title, preheader, companyName, bodyLines, ctaLabel, ctaUrl } = opts
  const cta =
    ctaLabel && ctaUrl
      ? `<tr><td style="padding:24px 0 8px;text-align:center;">
           <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background:#2563eb;color:#fff;border-radius:6px;font-size:14px;font-weight:600;text-decoration:none;">${ctaLabel}</a>
         </td></tr>`
      : ""

  const body = bodyLines
    .map((line) =>
      line === ""
        ? `<tr><td style="height:12px;"></td></tr>`
        : `<tr><td style="font-size:15px;color:#374151;line-height:1.6;">${line}</td></tr>`
    )
    .join("\n")

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
        <tr><td style="background:#1e293b;padding:24px 32px;">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">${companyName}</p>
        </td></tr>
        <tr><td style="padding:32px 32px 8px;">
          <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#111827;">${title}</h1>
          <table width="100%" cellpadding="0" cellspacing="0">
            ${body}
            ${cta}
          </table>
        </td></tr>
        <tr><td style="padding:24px 32px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;">
          &copy; ${new Date().getFullYear()} ${companyName}. All rights reserved.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

export function smtpConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS)
}
