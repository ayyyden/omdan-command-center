"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { Loader2, HardHat } from "lucide-react"
import { OmdanMark } from "@/components/brand/omdan-mark"

interface Props {
  logoUrl: string | null
}

export function LoginForm({ logoUrl }: Props) {
  const router = useRouter()
  const { toast } = useToast()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" })
      setLoading(false)
      return
    }

    router.push("/")
    router.refresh()
  }

  return (
    <div className="w-full max-w-sm">
      {/* Studio look: the tower mark draws itself on its ground line */}
      <div className="studio-only flex flex-col items-center text-center mb-8">
        <OmdanMark id="login" animated strokeWidth={1.8} className="h-24 w-24" title="Omdan Development" />
        <p className="font-title text-[30px] tracking-[0.28em] pl-[0.28em] text-[#E4C979] mt-4 leading-none">OMDAN</p>
        <p className="text-[13px] text-white/50 mt-2.5">Command Center</p>
      </div>
    <Card className="w-full shadow-2xl border-0">
      <CardHeader className="classic-only space-y-1 text-center">
        <div className="flex justify-center mb-2">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt="Omdan"
              className="w-16 h-16 object-contain"
            />
          ) : (
            <div className="flex items-center justify-center w-12 h-12 rounded-full bg-primary">
              <HardHat className="w-6 h-6 text-primary-foreground" />
            </div>
          )}
        </div>
        <CardTitle className="text-2xl font-bold">Omdan Command Center</CardTitle>
        <CardDescription>Sign in to manage your business</CardDescription>
      </CardHeader>
      <form onSubmit={handleLogin}>
        <CardContent className="login-fields space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@omdan.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Sign In
          </Button>
        </CardFooter>
      </form>
    </Card>
    </div>
  )
}
