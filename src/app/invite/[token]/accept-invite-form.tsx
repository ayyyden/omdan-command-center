"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import { Loader2 } from "lucide-react"

interface Props {
  token: string
  email: string
  name: string
  roleLabel: string
}

export function AcceptInviteForm({ token, email, name, roleLabel }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) {
      toast({ title: "Passwords don't match", variant: "destructive" })
      return
    }
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" })
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/team/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast({ title: "Could not create account", description: data.error, variant: "destructive" })
        return
      }
      toast({ title: "Account created!", description: "Sign in with your new password." })
      router.push("/login")
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      {/* Invite header */}
      <div className="px-6 py-4 border-b bg-muted/30">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold text-sm">{name}</p>
            <p className="text-xs text-muted-foreground truncate">{email}</p>
          </div>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary shrink-0">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Password form */}
      <form onSubmit={handleSubmit} className="p-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">Set a password</Label>
          <Input
            id="password"
            type="password"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type="password"
            placeholder="Repeat password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading && <Loader2 className="mr-2 w-4 h-4 animate-spin" />}
          Create Account &amp; Join
        </Button>
      </form>
    </div>
  )
}
