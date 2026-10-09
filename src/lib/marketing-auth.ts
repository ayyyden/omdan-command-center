import { requirePermission } from "@/lib/auth-helpers"

/** Ad Advisor routes: Lia's scheduler (x-assistant-secret) or a signed-in user with `permission`. */
export async function authorizeMarketing(req: Request, permission: "marketing:view" | "marketing:manage"): Promise<{ isCron: boolean } | Response> {
  const secret = req.headers.get("x-assistant-secret")
  if (secret && secret === process.env.ASSISTANT_SECRET) return { isCron: true }
  const session = await requirePermission(permission)
  if (session instanceof Response) return session
  return { isCron: false }
}
