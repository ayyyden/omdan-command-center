import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

// GET /api/bank/accounts
// Connected institutions + their accounts and current balances, for the bank UI page.
export async function GET() {
  const session = await requirePermission("bank:view")
  if (session instanceof Response) return session

  const service = createServiceClient()

  const { data: items, error } = await service
    .from("plaid_items")
    .select(`
      id,
      institution_name,
      status,
      error,
      last_synced_at,
      bank_accounts (
        id,
        name,
        official_name,
        type,
        subtype,
        mask,
        current_balance,
        available_balance,
        currency
      )
    `)
    .order("created_at", { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ institutions: items ?? [] })
}
