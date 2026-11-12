"use client"

// The page the "Reset your password" email links to. The one-time token is
// only used when they press Save (not when the page opens), then the new
// password is set and they're signed in.

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2 } from "lucide-react"

export function ResetPasswordForm({ token }: { token: string | null }) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) { setError("Use at least 8 characters."); return }
    if (password !== again) { setError("The two passwords don't match."); return }
    setSaving(true)
    const supabase = createClient()
    const { error: verifyErr } = await supabase.auth.verifyOtp({ token_hash: token!, type: "recovery" })
    if (verifyErr) {
      setError("This reset link has expired or was already used. Go back to the login page and press \"Forgot password?\" again.")
      setSaving(false)
      return
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) {
      setError(updateErr.message)
      setSaving(false)
      return
    }
    router.push("/dashboard")
    router.refresh()
  }

  return (
    <Card className="w-full max-w-sm shadow-2xl border-0">
      <CardHeader className="space-y-1 text-center">
        <CardTitle className="text-2xl font-bold">Choose a new password</CardTitle>
        <CardDescription>Omdan Command Center</CardDescription>
      </CardHeader>
      {!token ? (
        <CardContent className="space-y-4 text-sm text-center">
          <p>This link is missing its reset code. Open the link from the email again, or ask for a new one.</p>
          <Link href="/login" className="underline">Back to login</Link>
        </CardContent>
      ) : (
        <form onSubmit={save}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pw">New password</Label>
              <Input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pw2">Type it again</Label>
              <Input id="pw2" type="password" value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </CardContent>
          <CardFooter className="flex-col gap-3">
            <Button type="submit" className="w-full" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save new password
            </Button>
            <Link href="/login" className="text-sm text-muted-foreground underline">Back to login</Link>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
