import { NextRequest } from "next/server"
import { requirePermission } from "@/lib/auth-helpers"
import { createServiceClient } from "@/lib/supabase/service"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"
import { CountryCode } from "plaid"

// POST /api/bank/exchange-token
// Called right after a successful Plaid Link flow with the short-lived
// public_token. Exchanges it for a permanent access_token (stored only in
// plaid_items, a service-role-only table — see migration 056), then pulls
// the connected accounts.
export async function POST(req: NextRequest) {
  const session = await requirePermission("bank:manage")
  if (session instanceof Response) return session

  const body = await req.json().catch(() => ({})) as { public_token?: string }
  if (!body.public_token) {
    return Response.json({ error: "public_token is required" }, { status: 400 })
  }

  const plaid   = getPlaidClient()
  const service = createServiceClient() // plaid_items has no RLS policy for authenticated

  try {
    const exchange = await plaid.itemPublicTokenExchange({ public_token: body.public_token })
    const { access_token, item_id } = exchange.data

    let institutionId:   string | null = null
    let institutionName: string | null = null
    try {
      const itemInfo = await plaid.itemGet({ access_token })
      institutionId = itemInfo.data.item.institution_id ?? null
      if (institutionId) {
        const inst = await plaid.institutionsGetById({
          institution_id: institutionId,
          country_codes:  [CountryCode.Us],
        })
        institutionName = inst.data.institution.name
      }
    } catch (err) {
      console.warn("[bank/exchange-token] institution lookup failed (non-critical):", plaidErrorMessage(err))
    }

    const { data: plaidItem, error: itemErr } = await service
      .from("plaid_items")
      .insert({
        created_by:        session.userId,
        item_id,
        access_token,
        institution_id:    institutionId,
        institution_name:  institutionName,
      })
      .select("id")
      .single()

    if (itemErr || !plaidItem) {
      return Response.json({ error: `Failed to save bank connection: ${itemErr?.message}` }, { status: 500 })
    }

    const accountsRes = await plaid.accountsGet({ access_token })
    const accountRows = accountsRes.data.accounts.map((a) => ({
      plaid_item_id:      plaidItem.id,
      plaid_account_id:   a.account_id,
      name:                a.name,
      official_name:       a.official_name ?? null,
      type:                a.type,
      subtype:             a.subtype ?? null,
      mask:                a.mask ?? null,
      current_balance:     a.balances.current ?? null,
      available_balance:   a.balances.available ?? null,
      currency:            a.balances.iso_currency_code ?? "USD",
    }))

    if (accountRows.length) {
      const { error: acctErr } = await service.from("bank_accounts").insert(accountRows)
      if (acctErr) {
        console.error("[bank/exchange-token] failed to save accounts:", acctErr.message)
      }
    }

    return Response.json({
      ok:                true,
      institution_name:  institutionName,
      accounts_connected: accountRows.length,
    })
  } catch (err) {
    console.error("[bank/exchange-token] error:", err)
    return Response.json({ error: plaidErrorMessage(err) }, { status: 500 })
  }
}
