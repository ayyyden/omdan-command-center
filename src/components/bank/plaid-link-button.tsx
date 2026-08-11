"use client"

import { useCallback, useEffect, useState } from "react"
import { usePlaidLink } from "react-plaid-link"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

interface Props {
  onConnected: () => void
}

// Connect-a-bank button. Two-step Plaid flow: fetch a link_token from our
// server, then hand it to Plaid's hosted Link UI; on success, send the
// resulting public_token back to our server to exchange + store.
export function PlaidLinkButton({ onConnected }: Props) {
  const { toast } = useToast()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/bank/create-link-token", { method: "POST" })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setLinkToken(data.link_token ?? null)
      })
      .catch(() => {
        if (!cancelled) toast({ title: "Couldn't start bank connection", variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [toast])

  const onSuccess = useCallback(async (public_token: string | null) => {
    if (!public_token) return
    setLoading(true)
    try {
      const res = await fetch("/api/bank/exchange-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_token }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Failed to connect bank")
      toast({ title: `Connected ${data.institution_name ?? "your bank"} — ${data.accounts_connected} account(s)` })
      onConnected()
    } catch (err) {
      toast({ title: "Connection failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }, [toast, onConnected])

  const { open, ready } = usePlaidLink({ token: linkToken, onSuccess })

  return (
    <Button onClick={() => open()} disabled={!ready || loading}>
      {loading ? "Connecting…" : "Connect a bank"}
    </Button>
  )
}
