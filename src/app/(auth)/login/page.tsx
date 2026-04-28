import { createServiceClient } from "@/lib/supabase/service"
import { LoginForm } from "./login-form"

export default async function LoginPage() {
  const service = createServiceClient()
  const { data: cs } = await service
    .from("company_settings")
    .select("logo_url")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  return <LoginForm logoUrl={cs?.logo_url ?? null} />
}
