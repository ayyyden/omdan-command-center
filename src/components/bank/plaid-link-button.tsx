"use client"

import { useCallback, useEffect, useState } from "react"
import { usePlaidLink } from "react-plaid-link"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"

interface Props {
  onConnected: () => void
}

const STORAGE_KEY = "plaid_link_token"

// Connect-a-bank button. Two paths:
//  1. Normal: fetch a link_token from our server, hand it to Plaid's hosted
//     Link UI; on success, exchange the resulting public_token.
//  2. OAuth resume (Production only, institutions like Chase/BofA): Link
//     sends the browser away to the bank's real login, then back to our
//     redirect_uri with ?oauth_state_id=... in the URL. This component
//     mounts fresh on that return, so the original link_token — persisted
//     in localStorage before the redirect — has to be reused (a new one
//     won't resume the same session), passed back in via receivedRedirectUri.
export function PlaidLinkButton({ onConnected }: Props) {
  const { toast } = useToast()
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resuming, setResuming] = useState(false)

  useEffect(() => {
    let cancelled = false
    const isOAuthResume = window.location.search.includes("oauth_state_id")

    if (isOAuthResume) {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setLinkToken(stored)
        setResuming(true)
      } else {
        toast({ title: "Bank connection expired", description: "Please click Connect a bank and try again.", variant: "destructive" })
        window.history.replaceState(null, "", window.location.pathname)
      }
      return
    }

    setLoading(true)
    fetch("/api/bank/create-link-token", { method: "POST" })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !data.link_token) {
          toast({ title: "Couldn't start bank connection", description: data.error ?? `Server returned ${res.status}`, variant: "destructive" })
          return
        }
        window.localStorage.setItem(STORAGE_KEY, data.link_token)
        setLinkToken(data.link_token)
      })
      .catch((err) => {
        if (!cancelled) toast({ title: "Couldn't start bank connection", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [toast])

  const cleanup = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY)
    if (window.location.search.includes("oauth_state_id")) {
      window.history.replaceState(null, "", window.location.pathname)
    }
  }, [])

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
      cleanup()
    }
  }, [toast, onConnected, cleanup])

  const onExit = useCallback(() => cleanup(), [cleanup])

  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit,
    ...(resuming ? { receivedRedirectUri: window.location.href } : {}),
  })

  // Resuming after an OAuth redirect — reopen automatically instead of
  // waiting for another button click, since the user already clicked once.
  useEffect(() => {
    if (resuming && ready) open()
  }, [resuming, ready, open])

  return (
    <Button onClick={() => open()} disabled={!ready || loading}>
      {loading ? "Connecting…" : "Connect a bank"}
    </Button>
  )
}
