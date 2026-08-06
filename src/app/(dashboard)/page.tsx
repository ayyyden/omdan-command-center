import { redirect } from "next/navigation"
import { getSessionMember } from "@/lib/auth-helpers"

export default async function DashboardRoot() {
  const session = await getSessionMember()
  if (session?.role === "meta_lead") redirect("/meta-leads")
  if (session?.role === "lead_operator") redirect("/propstream-leads")
  redirect("/dashboard")
}
