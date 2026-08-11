import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"

// GET /api/bank/transactions?account_id=&match_status=&q=&page=&limit=
// Paginated transaction list for the bank UI page.
export async function GET(req: NextRequest) {
  const session = await requirePermission("bank:view")
  if (session instanceof Response) return session

  const params = req.nextUrl.searchParams
  const accountId    = params.get("account_id")
  const matchStatus  = params.get("match_status")
  const q            = params.get("q")
  const page         = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1)
  const limit        = Math.min(100, Math.max(1, parseInt(params.get("limit") ?? "50", 10) || 50))
  const from         = (page - 1) * limit
  const to           = from + limit - 1

  const service = createServiceClient()

  let query = service
    .from("bank_transactions")
    .select("*, bank_accounts(name, mask, plaid_item_id)", { count: "exact" })
    .order("date", { ascending: false })
    .range(from, to)

  if (accountId)   query = query.eq("bank_account_id", accountId)
  if (matchStatus) query = query.eq("match_status", matchStatus)
  if (q)           query = query.ilike("name", `%${q}%`)

  const { data, error, count } = await query

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ transactions: data ?? [], total: count ?? 0, page, limit })
}
