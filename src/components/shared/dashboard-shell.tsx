"use client"

import { useState, useEffect } from "react"
import { Menu, HardHat, Search, Bell } from "lucide-react"
import { Sidebar } from "./sidebar"
import { GlobalSearch } from "./global-search"
import { NotificationBell } from "./notification-bell"
import { UserRoleProvider } from "@/lib/user-role-context"
import type { TeamRole } from "@/lib/permissions"

interface DashboardShellProps {
  children: React.ReactNode
  logoUrl?: string | null
  companyName?: string | null
  userRole: TeamRole
  userName?: string | null
  pmId?: string | null
}

export function DashboardShell({ children, logoUrl, companyName, userRole, userName, pmId }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)

  useEffect(() => {
    const handler = (e: Event) => setNotifCount((e as CustomEvent<number>).detail)
    window.addEventListener("notification-count-update", handler)
    return () => window.removeEventListener("notification-count-update", handler)
  }, [])

  return (
    <UserRoleProvider role={userRole}>
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          logoUrl={logoUrl}
          companyName={companyName}
          userRole={userRole}
          userName={userName}
        />

        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Mobile-only top strip */}
          <div
            className="md:hidden flex items-center gap-3 px-4 pb-3 border-b bg-card shrink-0"
            style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
          >
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>

            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={companyName ?? "Company logo"}
                className="h-7 w-auto max-w-[140px] object-contain"
              />
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary shrink-0">
                  <HardHat className="w-4 h-4 text-primary-foreground" />
                </div>
                <span className="font-bold text-sm text-foreground">
                  {companyName ?? "Omdan Command Center"}
                </span>
              </div>
            )}

            <div className="ml-auto flex items-center gap-1">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("open-notifications"))}
                className="relative p-1.5 rounded-lg hover:bg-accent transition-colors"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 text-[9px] font-bold bg-destructive text-destructive-foreground rounded-full leading-none">
                    {notifCount > 99 ? "99+" : notifCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("open-global-search"))}
                className="p-1.5 rounded-lg hover:bg-accent transition-colors"
                aria-label="Search"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>
          </div>

          <main
            className="flex-1 overflow-y-auto overscroll-none"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
          >
            {children}
          </main>
        </div>

        <GlobalSearch />
        <NotificationBell role={userRole} pmId={pmId ?? null} />
      </div>
    </UserRoleProvider>
  )
}
