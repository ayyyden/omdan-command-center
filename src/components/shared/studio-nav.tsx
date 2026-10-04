"use client"

// Navigation for the "studio" design: a basalt side rail on desktop (can be
// collapsed to icons), and on phones a slim top bar + a bottom tab bar with
// a quick-add button. The rail doubles as the phone's "More" drawer.
// Rendered alongside the classic Sidebar; CSS shows one or the other.

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import {
  Bell, ChevronsLeft, ChevronsRight, LayoutDashboard, LogOut, Menu, Plus,
  Search, Briefcase, Calendar, UserPlus, FilePlus2, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { can } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { ROLE_LABELS } from "@/lib/permissions"
import { navItems } from "./sidebar"
import { OmdanMark, OmdanLockup } from "@/components/brand/omdan-mark"
import { DesignSwitchButton } from "@/components/providers/design-switch"

const GROUPS: { label: string; hrefs: string[] }[] = [
  { label: "Work",  hrefs: ["/dashboard", "/customers", "/estimates", "/jobs", "/scheduler"] },
  { label: "Money", hrefs: ["/payments", "/expenses", "/bank", "/reports"] },
  { label: "Tools", hrefs: ["/contracts", "/propstream-leads", "/meta-leads", "/calculator", "/lia"] },
]

const LABELS: Record<string, string> = {
  "/customers": "Customers & leads",
  "/meta-leads": "Meta lead jobs",
  "/propstream-leads": "Lead center",
}

function isActive(pathname: string, href: string) {
  return href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href)
}

function useNotifCount() {
  const [n, setN] = useState(0)
  useEffect(() => {
    const h = (e: Event) => setN((e as CustomEvent<number>).detail)
    window.addEventListener("notification-count-update", h)
    return () => window.removeEventListener("notification-count-update", h)
  }, [])
  return n
}

function CountDot({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null
  return (
    <span className={cn("flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-semibold rounded-full bg-[var(--brick)] text-white leading-none tabular-nums", className)}>
      {n > 99 ? "99+" : n}
    </span>
  )
}

interface NavProps {
  userRole: TeamRole
  userName?: string | null
}

// ── Side rail (desktop) / drawer (phone) ────────────────────────────────────

export function StudioRail({ userRole, userName, open, onClose }: NavProps & { open: boolean; onClose: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const notif = useNotifCount()
  const visible = navItems.filter((i) => i.roles.includes(userRole))
  const settings = visible.find((i) => i.href === "/settings")

  function toggleRail() {
    const collapsed = document.documentElement.getAttribute("data-rail") === "collapsed"
    const next = collapsed ? "open" : "collapsed"
    document.documentElement.setAttribute("data-rail", next)
    try { localStorage.setItem("omdan-rail", next) } catch {}
  }

  async function signOut() {
    await createClient().auth.signOut()
    router.push("/login")
    router.refresh()
  }

  const item = (href: string) => {
    const nav = visible.find((i) => i.href === href)
    if (!nav) return null
    const active = isActive(pathname, href)
    const Icon = nav.icon
    const label = LABELS[href] ?? nav.label
    return (
      <Link
        key={href}
        href={href}
        onClick={onClose}
        title={label}
        aria-current={active ? "page" : undefined}
        className={cn("rail-link", active && "is-active")}
      >
        <Icon className="w-[18px] h-[18px] shrink-0" />
        <span className="rail-label truncate">{label}</span>
      </Link>
    )
  }

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-[2px] md:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={cn("studio-rail", open && "is-open")}
        style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex items-center justify-between gap-2 px-4 h-[68px] shrink-0">
          <Link href="/dashboard" onClick={onClose} className="rail-brand" aria-label="Omdan — dashboard">
            <OmdanMark id="rail" className="rail-brand-mark h-9 w-9 shrink-0" />
            <span className="rail-label flex flex-col leading-none">
              <span className="font-title text-[18px] tracking-[0.2em] text-[var(--brass-light)]">OMDAN</span>
              <span className="mt-1 text-[11px] text-white/45">Command Center</span>
            </span>
          </Link>
          <button className="md:hidden p-2 -mr-1 rounded-lg text-white/60 hover:text-white hover:bg-white/5" onClick={onClose} aria-label="Close menu">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-3 pb-2 space-y-1.5">
          <button
            onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("open-global-search")) }}
            className="rail-search"
            title="Search"
          >
            <Search className="w-4 h-4 shrink-0" />
            <span className="rail-label flex-1 text-left">Search</span>
            <kbd className="rail-label hidden md:inline text-[10px] text-white/35 font-sans">Ctrl K</kbd>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
          {GROUPS.map((g) => {
            const links = g.hrefs.map(item).filter(Boolean)
            if (!links.length) return null
            return (
              <div key={g.label} className="mt-3 first:mt-1">
                <p className="rail-group">{g.label}</p>
                <div className="space-y-0.5">{links}</div>
              </div>
            )
          })}
        </nav>

        <div className="px-3 py-3 border-t border-white/[0.07] space-y-0.5">
          {can(userRole, "notifications:view") && (
            <button
              onClick={() => { onClose(); window.dispatchEvent(new CustomEvent("open-notifications")) }}
              className="rail-link w-full"
              title="Notifications"
            >
              <span className="relative">
                <Bell className="w-[18px] h-[18px] shrink-0" />
                {notif > 0 && <span className="rail-dot" />}
              </span>
              <span className="rail-label flex-1 text-left">Notifications</span>
              <CountDot n={notif} className="rail-label" />
            </button>
          )}
          {settings && item("/settings")}
          <div className="rail-row">
            <DesignSwitchButton short className="rail-link flex-1 min-w-0" labelClassName="rail-label" />
            <button onClick={toggleRail} className="rail-link hidden md:flex shrink-0" title="Collapse or expand menu" aria-label="Collapse or expand menu">
              <ChevronsLeft className="rail-collapse-icon w-[18px] h-[18px] shrink-0" />
              <ChevronsRight className="rail-expand-icon w-[18px] h-[18px] shrink-0" />
            </button>
          </div>

          {userName && (
            <div className="flex items-center gap-3 px-2.5 pt-3 mt-2 border-t border-white/[0.07]">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--brass)]/15 text-[var(--brass-light)] font-title text-sm shrink-0">
                {userName.charAt(0).toUpperCase()}
              </span>
              <span className="rail-label flex-1 min-w-0">
                <span className="block text-[13px] text-white/90 truncate">{userName}</span>
                <span className="block text-[11px] text-white/45 truncate">{ROLE_LABELS[userRole] ?? userRole}</span>
              </span>
              <button onClick={signOut} className="rail-label p-2 -mr-1 rounded-lg text-white/45 hover:text-white hover:bg-white/5" title="Sign out" aria-label="Sign out">
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}

// ── Phone: top bar ──────────────────────────────────────────────────────────

export function StudioTopBar({ userRole }: { userRole: TeamRole }) {
  const notif = useNotifCount()
  return (
    <header
      className="studio-topbar md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="flex items-center gap-2 h-14 px-3">
        <Link href="/dashboard" className="flex items-center" aria-label="Omdan — dashboard">
          <OmdanLockup id="topbar" sub={null} className="[&_svg]:h-8 [&_svg]:w-8 gap-2.5" />
        </Link>
        <div className="ml-auto flex items-center">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("open-global-search"))}
            className="topbar-btn"
            aria-label="Search"
          >
            <Search className="w-[20px] h-[20px]" />
          </button>
          {can(userRole, "notifications:view") && (
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("open-notifications"))}
              className="topbar-btn relative"
              aria-label={`Notifications${notif ? ` (${notif})` : ""}`}
            >
              <Bell className="w-[20px] h-[20px]" />
              <CountDot n={notif} className="absolute top-1 right-0.5" />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}

// ── Phone: bottom tab bar ───────────────────────────────────────────────────

export function StudioTabBar({ userRole, onMore }: { userRole: TeamRole; onMore: () => void }) {
  const pathname = usePathname()
  const [quickOpen, setQuickOpen] = useState(false)
  const allowed = new Set(navItems.filter((i) => i.roles.includes(userRole)).map((i) => i.href))

  useEffect(() => { setQuickOpen(false) }, [pathname])

  const tabs = [
    { href: "/dashboard", label: "Home",     icon: LayoutDashboard },
    { href: "/jobs",      label: "Jobs",     icon: Briefcase },
    { href: "/scheduler", label: "Calendar", icon: Calendar },
  ].filter((t) => allowed.has(t.href))

  const quick = [
    allowed.has("/customers") && { href: "/customers/new", label: "New lead",     hint: "Add a customer or lead", icon: UserPlus },
    allowed.has("/estimates") && { href: "/estimates/new", label: "New estimate", hint: "Start a priced estimate", icon: FilePlus2 },
  ].filter(Boolean) as { href: string; label: string; hint: string; icon: typeof Plus }[]

  const left = tabs.slice(0, 2)
  const right = tabs.slice(2)

  const tab = (t: (typeof tabs)[number]) => {
    const active = isActive(pathname, t.href)
    return (
      <Link key={t.href} href={t.href} className={cn("tab-link", active && "is-active")} aria-current={active ? "page" : undefined}>
        <t.icon className="w-[22px] h-[22px]" />
        <span>{t.label}</span>
      </Link>
    )
  }

  return (
    <>
      {quickOpen && (
        <div className="fixed inset-0 z-40 md:hidden" onClick={() => setQuickOpen(false)}>
          <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />
          <div
            className="quick-sheet"
            style={{ bottom: "calc(76px + env(safe-area-inset-bottom))" }}
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            {quick.map((q) => (
              <Link key={q.href} href={q.href} className="quick-item" role="menuitem">
                <span className="quick-icon"><q.icon className="w-5 h-5" /></span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{q.label}</span>
                  <span className="block text-[13px] text-muted-foreground">{q.hint}</span>
                </span>
              </Link>
            ))}
            <button
              className="quick-item w-full text-left"
              role="menuitem"
              onClick={() => { setQuickOpen(false); window.dispatchEvent(new CustomEvent("open-global-search")) }}
            >
              <span className="quick-icon"><Search className="w-5 h-5" /></span>
              <span>
                <span className="block text-[15px] font-medium">Find anything</span>
                <span className="block text-[13px] text-muted-foreground">Customers, jobs, estimates</span>
              </span>
            </button>
          </div>
        </div>
      )}

      <nav className="studio-tabbar md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Quick navigation">
        <div className="grid grid-cols-5 items-end h-[64px] px-1">
          {left.map(tab)}
          {left.length < 2 && <span />}
          <div className="flex justify-center">
            <button
              onClick={() => setQuickOpen((v) => !v)}
              className={cn("tab-plus", quickOpen && "is-open")}
              aria-label={quickOpen ? "Close quick add" : "Quick add"}
              aria-expanded={quickOpen}
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>
          {right.map(tab)}
          {right.length < 1 && <span />}
          <button onClick={onMore} className="tab-link" aria-label="More">
            <Menu className="w-[22px] h-[22px]" />
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
