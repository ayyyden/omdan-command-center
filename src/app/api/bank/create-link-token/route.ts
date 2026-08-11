import { requirePermission } from "@/lib/auth-helpers"
import { getPlaidClient, plaidErrorMessage } from "@/lib/plaid"
import { Products, CountryCode, type LinkTokenCreateRequest } from "plaid"

export async function POST() {
  const session = await requirePermission("bank:manage")
  if (session instanceof Response) return session

  try {
    const plaid = getPlaidClient()

    const request: LinkTokenCreateRequest = {
      user:          { client_user_id: session.userId },
      client_name:   "Omdan Command Center",
      products:      [Products.Transactions],
      country_codes: [CountryCode.Us],
      language:      "en",
    }

    // OAuth institutions (Chase, BofA, Wells Fargo, etc.) require a
    // registered redirect_uri in Production — the browser is sent to the
    // bank's real login, then back to this exact URL (no query params
    // allowed here; Plaid appends its own ?oauth_state_id=... on return).
    // Must also be added to Allowed redirect URIs in the Plaid dashboard
    // (Team Settings → API). Not needed/used in Sandbox.
    if ((process.env.PLAID_ENV ?? "sandbox").toLowerCase() === "production") {
      request.redirect_uri = process.env.PLAID_REDIRECT_URI ?? "https://omdancommandcenter.com/bank"
    }

    const { data } = await plaid.linkTokenCreate(request)
    return Response.json({ link_token: data.link_token })
  } catch (err) {
    console.error("[bank/create-link-token] error:", err)
    return Response.json({ error: plaidErrorMessage(err) }, { status: 500 })
  }
}
