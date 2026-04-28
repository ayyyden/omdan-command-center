"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboard, Users, FileText, Briefcase, Calendar,
  Receipt, DollarSign, BarChart3, HardHat, LogOut, Settings,
  ScrollText, X, Search, Bell, UsersRound,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { useState, useEffect } from "react"
import type { TeamRole } from "@/lib/permissions"
import { RoleBadge } from "@/components/team/role-badge"

const ALL_ROLES: TeamRole[] = ["owner", "admin", "project_manager", "office", "field_worker", "viewer"]

const navItems = [
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard, roles: ALL_ROLES },
  { href: "/customers",  label: "CRM / Leads", icon: Users,           roles: ["owner", "admin"] as TeamRole[] },
  { href: "/estimates",  label: "Estimates",   icon: FileText,        roles: ["owner", "admin", "office", "project_manager"] as TeamRole[] },
  { href: "/jobs",       label: "Jobs",        icon: Briefcase,       roles: ALL_ROLES },
  { href: "/scheduler",  label: "Scheduler",   icon: Calendar,        roles: ALL_ROLES },
  { href: "/expenses",   label: "Expenses",    icon: Receipt,         roles: ["owner", "admin"] as TeamRole[] },
  { href: "/payments",   label: "Payments",    icon: DollarSign,      roles: ["owner", "admin"] as TeamRole[] },
  { href: "/reports",    label: "Reports",     icon: BarChart3,       roles: ["owner", "admin"] as TeamRole[] },
  { href: "/contracts",  label: "Contracts",   icon: ScrollText,      roles: ["owner", "admin", "office"] as TeamRole[] },
  { href: "/settings",   label: "Settings",    icon: Settings,        roles: ALL_ROLES },
]

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
  logoUrl?: string | null
  companyName?: string | null
  userRole?: TeamRole
  userName?: string | null
}

export function Sidebar({ isOpen = false, onClose, logoUrl, companyName, userRole, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [notifCount, setNotifCount] = useState(0)

  useEffect(() => {
    const handler = (e: Event) => setNotifCount((e as CustomEvent<number>).detail)
    window.addEventListener("notification-count-update", handler)
    return () => window.removeEventListener("notification-count-update", handler)
  }, [])

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login")
    router.refresh()
  }

  const visibleNav = userRole
    ? navItems.filter((item) => item.roles.includes(userRole))
    : navItems

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={cn(
          "flex flex-col bg-sidebar text-sidebar-foreground border-r border-sidebar-border shrink-0",
          "fixed inset-y-0 left-0 z-50 w-72 transition-transform duration-300",
          "md:static md:w-64 md:min-h-screen md:translate-x-0 md:z-auto md:transition-none",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
        style={{
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName ?? "Company logo"}
                className="w-9 h-9 rounded-lg object-contain shrink-0"
              />
            ) : (
              <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-primary shrink-0">
                <HardHat className="w-5 h-5 text-primary-foreground" />
              </div>
            )}
            <div>
              <p className="text-sm font-bold leading-tight text-sidebar-foreground">Omdan</p>
              <p className="text-xs text-sidebar-foreground/60 leading-tight">Command Center</p>
            </div>
          </div>
          <button
            className="md:hidden p-1.5 rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            onClick={onClose}
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search trigger */}
        <div className="px-3 pt-3 pb-1">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-global-search"))}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm font-medium text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors border border-sidebar-border/60 bg-sidebar-accent/20"
          >
            <Search className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1 text-left text-xs">Search…</span>
            <kbd className="hidden sm:flex items-center text-[10px] font-mono opacity-50 bg-sidebar-accent/60 px-1.5 py-0.5 rounded border border-sidebar-border/40 leading-tight">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {visibleNav.map(({ href, label, icon: Icon }) => {
            const active = href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
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
        <div className="px-3 py-4 border-t border-sidebar-border space-y-0.5">
          {/* User info + role */}
          {userName && userRole && (
            <div className="flex items-center gap-2 px-3 py-2 mb-1">
              <div className="w-7 h-7 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-bold text-sidebar-foreground shrink-0 uppercase">
                {userName.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-sidebar-foreground truncate">{userName}</p>
              </div>
              <RoleBadge role={userRole} />
            </div>
          )}

          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-notifications"))}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
            aria-label={`Notifications${notifCount > 0 ? ` (${notifCount})` : ""}`}
          >
            <Bell className="w-4 h-4 shrink-0" />
            Notifications
            {notifCount > 0 && (
              <span className="ml-auto flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full leading-none">
                {notifCount > 99 ? "99+" : notifCount}
              </span>
            )}
          </button>

          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  )
}
