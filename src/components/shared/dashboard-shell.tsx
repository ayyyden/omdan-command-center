"use client"

import { useState, useEffect } from "react"
import { Menu, HardHat, Search, Bell } from "lucide-react"
import { Sidebar } from "./sidebar"
import { GlobalSearch } from "./global-search"
import { NotificationBell } from "./notification-bell"

interface DashboardShellProps {
  children: React.ReactNode
  logoUrl?: string | null
  companyName?: string | null
}

export function DashboardShell({ children, logoUrl, companyName }: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [notifCount, setNotifCount] = useState(0)

  useEffect(() => {
    const handler = (e: Event) => setNotifCount((e as CustomEvent<number>).detail)
    window.addEventListener("notification-count-update", handler)
    return () => window.removeEventListener("notification-count-update", handler)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Mobile-only top strip */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 border-b bg-card shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-accent transition-colors"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Logo / company name */}
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

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>

      {/* Modals — rendered outside scroll container */}
      <GlobalSearch />
      <NotificationBell />
    </div>
  )
}
