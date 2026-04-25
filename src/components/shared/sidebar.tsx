"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard,
  Users,
  FileText,
  Briefcase,
  Calendar,
  Receipt,
  DollarSign,
  BarChart3,
  HardHat,
  LogOut,
  Settings,
  ScrollText,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/customers", label: "CRM / Leads", icon: Users },
  { href: "/estimates", label: "Estimates", icon: FileText },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/scheduler", label: "Scheduler", icon: Calendar },
  { href: "/expenses", label: "Expenses", icon: Receipt },
  { href: "/payments", label: "Payments", icon: DollarSign },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/contracts", label: "Contracts", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  return (
    <aside className="flex flex-col w-64 min-h-screen bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary shrink-0">
          <HardHat className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-sidebar-foreground">Omdan</p>
          <p className="text-xs text-sidebar-foreground/60 leading-tight">Command Center</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign Out
        </button>
      </div>
    </aside>
  )
}
