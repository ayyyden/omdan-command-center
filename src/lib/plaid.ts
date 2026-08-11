// Plaid client — bank account connections + transaction sync.
//
// Access tokens are the equivalent of a password that can read months of
// full bank transaction history — they live only in `plaid_items.access_token`,
// a table with NO RLS policies for authenticated users (service-role only).
// Never select/return that column outside a server-side route using
// createServiceClient(), and never send it to the browser.

import { Configuration, PlaidApi, PlaidEnvironments } from "plaid"

function resolveEnv(): keyof typeof PlaidEnvironments {
  const env = (process.env.PLAID_ENV ?? "sandbox").toLowerCase()
  if (env === "production") return "production"
  if (env === "development") return "development"
  return "sandbox"
}

let client: PlaidApi | null = null

export function getPlaidClient(): PlaidApi {
  if (client) return client

  const clientId = process.env.PLAID_CLIENT_ID
  const secret   = process.env.PLAID_SECRET
  if (!clientId || !secret) {
    throw new Error("Plaid is not configured — set PLAID_CLIENT_ID and PLAID_SECRET")
  }

  const configuration = new Configuration({
    basePath: PlaidEnvironments[resolveEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET":    secret,
      },
    },
  })

  client = new PlaidApi(configuration)
  return client
}

// Plaid's axios-based SDK puts the useful error details in err.response.data
// (error_code, error_message) — a bare err.message is usually just "Request
// failed with status code 400".
export function plaidErrorMessage(err: unknown): string {
  const data = (err as { response?: { data?: { error_message?: string; error_code?: string } } })?.response?.data
  if (data?.error_message) return data.error_code ? `${data.error_message} (${data.error_code})` : data.error_message
  return err instanceof Error ? err.message : String(err)
}
