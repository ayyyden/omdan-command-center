"use client"

import { useState } from "react"
import { Menu, HardHat } from "lucide-react"
import { Sidebar } from "./sidebar"

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

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
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-primary shrink-0">
              <HardHat className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-sm text-foreground">Omdan Command Center</span>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  )
}
