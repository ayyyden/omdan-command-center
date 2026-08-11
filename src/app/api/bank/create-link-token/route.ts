import { requirePermission } from "@/lib/auth-helpers"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"
import { Products, CountryCode } from "plaid"

export async function POST() {
  const session = await requirePermission("bank:manage")
  if (session instanceof Response) return session

  try {
    const plaid = getPlaidClient()
    const { data } = await plaid.linkTokenCreate({
      user:          { client_user_id: session.userId },
      client_name:   "Omdan Command Center",
      products:      [Products.Transactions],
      country_codes: [CountryCode.Us],
      language:      "en",
    })
    return Response.json({ link_token: data.link_token })
  } catch (err) {
    console.error("[bank/create-link-token] error:", err)
    return Response.json({ error: plaidErrorMessage(err) }, { status: 500 })
  }
}
