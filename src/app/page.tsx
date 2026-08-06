import { redirect } from "next/navigation"
import { getSessionMember } from "@/lib/auth-helpers"

// Root page defers to the (dashboard) route group which handles /
// Redirect to /dashboard to avoid conflict with (dashboard)/page.tsx
// Restricted single-page roles skip /dashboard (they can't access it) and go
// straight to their own workspace instead.
export default async function RootPage() {
  const session = await getSessionMember()
  if (session?.role === "meta_lead") redirect("/meta-leads")
  if (session?.role === "lead_operator") redirect("/propstream-leads")
  redirect("/dashboard")
}
