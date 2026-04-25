import { redirect } from "next/navigation"

// Root page defers to the (dashboard) route group which handles /
// Redirect to /dashboard to avoid conflict with (dashboard)/page.tsx
export default function RootPage() {
  redirect("/dashboard")
}
