"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ShieldX, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

export default function AccessDeniedPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  async function handleSignOut() {
    setLoading(true)
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4 text-center">
      <div className="w-full max-w-sm space-y-4">
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-destructive/10 mx-auto">
          <ShieldX className="w-8 h-8 text-destructive" />
        </div>
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-muted-foreground text-sm">
          Your account is not an active member of this workspace. You may not
          have been invited yet, or your access may have been disabled.
        </p>
        <p className="text-muted-foreground text-sm">
          Contact your administrator to request an invite or have your access
          restored.
        </p>
        <Button onClick={handleSignOut} disabled={loading} variant="outline">
          {loading
            ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Signing out…</>
            : "Sign Out and Return to Login"}
        </Button>
      </div>
    </div>
  )
}
