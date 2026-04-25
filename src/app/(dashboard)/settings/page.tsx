import Link from "next/link"
import { Topbar } from "@/components/shared/topbar"
import { Card, CardContent } from "@/components/ui/card"
import { Users2, ChevronRight, Palette, Building2, MessageSquare } from "lucide-react"

const settingsSections = [
  {
    href: "/settings/company",
    icon: Building2,
    title: "Company Settings",
    description: "Business info, license number, and document defaults for estimates and invoices.",
  },
  {
    href: "/settings/message-templates",
    icon: MessageSquare,
    title: "Message Templates",
    description: "Create and manage templates for customer communication with variable placeholders.",
  },
  {
    href: "/settings/project-managers",
    icon: Users2,
    title: "Project Managers",
    description: "Add, edit, and deactivate project managers for job scheduling.",
  },
  {
    href: "/settings/appearance",
    icon: Palette,
    title: "Appearance",
    description: "Switch between light and dark theme.",
  },
]

const appVersion = process.env.NEXT_PUBLIC_APP_VERSION
const buildTime  = process.env.NEXT_PUBLIC_BUILD_TIME

export default function SettingsPage() {
  return (
    <div>
      <Topbar title="Settings" subtitle="Manage your account and team" />
      <div className="p-4 sm:p-6 max-w-2xl space-y-3">
        {settingsSections.map(({ href, icon: Icon, title, description }) => (
          <Link key={href} href={href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted shrink-0">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{title}</p>
                  <p className="text-sm text-muted-foreground">{description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        ))}

        {(appVersion || buildTime) && (
          <div className="pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              {appVersion && <>Version {appVersion}</>}
              {appVersion && buildTime && " · "}
              {buildTime && <>Built {buildTime}</>}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
