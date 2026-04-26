"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import {
  Search, X, Users, Briefcase, FileText, ScrollText,
  Paperclip, Loader2, ArrowRight,
} from "lucide-react"
import { cn } from "@/lib/utils"

type ResultType = "customer" | "job" | "estimate" | "contract" | "file"

interface SearchResult {
  id: string
  type: ResultType
  title: string
  subtitle: string
  href: string
}

const TYPE_CONFIG: Record<ResultType, { label: string; icon: React.ElementType; color: string }> = {
  customer: { label: "Customer", icon: Users,      color: "text-emerald-600 dark:text-emerald-400" },
  job:      { label: "Job",      icon: Briefcase,  color: "text-blue-600 dark:text-blue-400" },
  estimate: { label: "Estimate", icon: FileText,   color: "text-purple-600 dark:text-purple-400" },
  contract: { label: "Contract", icon: ScrollText, color: "text-orange-600 dark:text-orange-400" },
  file:     { label: "File",     icon: Paperclip,  color: "text-muted-foreground" },
}

// Escape LIKE special characters so user text doesn't act as pattern syntax
function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, (c) => `\\${c}`)
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // External open trigger (from sidebar / mobile header buttons)
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener("open-global-search", handler)
    return () => window.removeEventListener("open-global-search", handler)
  }, [])

  // Ctrl+K / Cmd+K — toggle open
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Focus input when opening; reset state when closing
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 40)
    } else {
      setQuery("")
      setResults([])
      setLoading(false)
      setActiveIdx(0)
    }
  }, [open])

  // Debounced search as query changes
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => runSearch(trimmed), 220)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query])

  async function runSearch(raw: string) {
    const supabase = createClient()
    const q = escapeLike(raw)
    const like = `%${q}%`

    const [cust, jobs, ests, contracts, files] = await Promise.all([
      supabase
        .from("customers")
        .select("id, name, phone, email, service_type")
        .or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like},address.ilike.${like}`)
        .limit(5),

      supabase
        .from("jobs")
        .select("id, title, status, customer:customers(name)")
        .or(`title.ilike.${like},description.ilike.${like}`)
        .limit(5),

      supabase
        .from("estimates")
        .select("id, title, status, customer:customers(name)")
        .ilike("title", like)
        .limit(5),

      supabase
        .from("contract_templates")
        .select("id, name, is_active")
        .ilike("name", like)
        .limit(4),

      supabase
        .from("files")
        .select("id, file_name, entity_type, entity_id, category")
        .ilike("file_name", like)
        .limit(5),
    ])

    const out: SearchResult[] = [
      ...(cust.data ?? []).map((c) => ({
        id: `c-${c.id}`,
        type: "customer" as const,
        title: c.name,
        subtitle: [c.phone, c.email, c.service_type].filter(Boolean).join(" · "),
        href: `/customers/${c.id}`,
      })),
      ...(jobs.data ?? []).map((j) => ({
        id: `j-${j.id}`,
        type: "job" as const,
        title: j.title,
        subtitle: [(j.customer as any)?.name, j.status.replace(/_/g, " ")].filter(Boolean).join(" · "),
        href: `/jobs/${j.id}`,
      })),
      ...(ests.data ?? []).map((e) => ({
        id: `e-${e.id}`,
        type: "estimate" as const,
        title: e.title,
        subtitle: [(e.customer as any)?.name, e.status].filter(Boolean).join(" · "),
        href: `/estimates/${e.id}`,
      })),
      ...(contracts.data ?? []).map((c) => ({
        id: `ct-${c.id}`,
        type: "contract" as const,
        title: c.name,
        subtitle: c.is_active ? "Active" : "Inactive",
        href: `/contracts`,
      })),
      ...(files.data ?? []).map((f) => {
        const href = f.entity_type && f.entity_id
          ? `/${f.entity_type}/${f.entity_id}`
          : `/contracts`
        return {
          id: `f-${f.id}`,
          type: "file" as const,
          title: f.file_name,
          subtitle: f.category ? f.category.replace(/_/g, " ") : "File",
          href,
        }
      }),
    ]

    setResults(out)
    setActiveIdx(0)
    setLoading(false)
  }

  function select(result: SearchResult) {
    router.push(result.href)
    setOpen(false)
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { setOpen(false); return }
    if (results.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (results[activeIdx]) select(results[activeIdx])
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 sm:px-6"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(3px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
    >
      <div className="w-full max-w-xl bg-card rounded-xl shadow-2xl border border-border overflow-hidden">
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border">
          {loading
            ? <Loader2 className="w-4 h-4 text-muted-foreground shrink-0 animate-spin" />
            : <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          }
          <input
            ref={inputRef}
            type="text"
            placeholder="Search customers, jobs, estimates, contracts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex items-center gap-2 shrink-0">
            {query && (
              <button
                onMouseDown={(e) => { e.preventDefault(); setQuery("") }}
                className="p-0.5 rounded text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="hidden sm:flex h-5 items-center px-1.5 text-[10px] font-mono text-muted-foreground bg-muted rounded border border-border">
              Esc
            </kbd>
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[55vh] overflow-y-auto">
          {query.trim().length < 2 ? (
            <div className="py-10 text-center text-sm text-muted-foreground select-none">
              Type at least 2 characters to search
            </div>
          ) : results.length === 0 && !loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground select-none">
              No results for <span className="font-medium text-foreground">"{query}"</span>
            </div>
          ) : (
            <ul className="py-1">
              {results.map((r, i) => {
                const cfg = TYPE_CONFIG[r.type]
                const Icon = cfg.icon
                return (
                  <li key={r.id}>
                    <button
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                        i === activeIdx ? "bg-accent" : "hover:bg-accent/60",
                      )}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => select(r)}
                    >
                      <Icon className={cn("w-4 h-4 shrink-0", cfg.color)} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground leading-tight truncate">
                          {r.title}
                        </p>
                        {r.subtitle && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5 leading-tight capitalize">
                            {r.subtitle}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex items-center gap-2">
                        <span className="text-[10px] font-medium text-muted-foreground bg-muted px-1.5 py-0.5 rounded whitespace-nowrap">
                          {cfg.label}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-muted/40 text-[10px] text-muted-foreground select-none">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-background rounded border border-border font-mono leading-tight">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-background rounded border border-border font-mono leading-tight">↵</kbd>
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-background rounded border border-border font-mono leading-tight">Esc</kbd>
            close
          </span>
          <span className="ml-auto opacity-60">
            {results.length > 0 ? `${results.length} result${results.length !== 1 ? "s" : ""}` : ""}
          </span>
        </div>
      </div>
    </div>
  )
}
