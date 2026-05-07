import { getSessionMember } from "@/lib/auth-helpers"
import { can } from "@/lib/permissions"
import { redirect } from "next/navigation"
import { Topbar } from "@/components/shared/topbar"
import { ImportForm } from "@/components/propstream/import-form"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function PropStreamImportPage() {
  const session = await getSessionMember()
  if (!session) redirect("/login")
  if (!can(session.role, "propstream:import")) redirect("/access-denied")

  return (
    <div>
      <Topbar
        title="Import Leads"
        subtitle="Upload a PropStream CSV export"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/propstream-leads">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Leads
            </Link>
          </Button>
        }
      />
      <div className="p-4 sm:p-6 max-w-xl">
        <ImportForm />
      </div>
    </div>
  )
}
