"use client"

import { useRouter, usePathname } from "next/navigation"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"

const CATEGORIES = [
  "materials", "labor", "subcontractors", "permits", "dump_fees",
  "equipment", "gas", "vehicle", "tools", "office_rent", "software",
  "insurance", "marketing", "meals", "travel", "misc",
]

const CAT_LABEL = (c: string) => c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())

interface Props {
  currentType: string
  currentCategory: string
  currentFrom: string
  currentTo: string
}

export function ExpensesFilters({ currentType, currentCategory, currentFrom, currentTo }: Props) {
  const router   = useRouter()
  const pathname = usePathname()

  function push(updates: Record<string, string>) {
    const merged = {
      type:     currentType,
      category: currentCategory,
      from:     currentFrom,
      to:       currentTo,
      ...updates,
    }
    const params = new URLSearchParams()
    Object.entries(merged).forEach(([k, v]) => {
      if (v && v !== "all") params.set(k, v)
    })
    const qs = params.toString()
    router.push(`${pathname}${qs ? `?${qs}` : ""}`)
  }

  const hasFilters =
    (currentType && currentType !== "all") ||
    (currentCategory && currentCategory !== "all") ||
    currentFrom ||
    currentTo

  const TYPE_OPTIONS = [
    { value: "all",      label: "All" },
    { value: "job",      label: "Job" },
    { value: "business", label: "Business" },
  ]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Type tabs */}
      <div className="flex rounded-md border overflow-hidden">
        {TYPE_OPTIONS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={cn(
              "px-3 py-1.5 text-sm font-medium transition-colors",
              (currentType === value || (!currentType && value === "all"))
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-muted",
            )}
            onClick={() => push({ type: value })}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Category */}
      <Select value={currentCategory || "all"} onValueChange={(v) => push({ category: v })}>
        <SelectTrigger className="h-8 w-[170px] text-sm">
          <SelectValue placeholder="All Categories" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Categories</SelectItem>
          {CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>{CAT_LABEL(c)}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Date range */}
      <div className="flex items-center gap-1">
        <Input
          type="date"
          className="h-8 w-[132px] text-sm"
          value={currentFrom}
          onChange={(e) => push({ from: e.target.value })}
        />
        <span className="text-muted-foreground text-xs">–</span>
        <Input
          type="date"
          className="h-8 w-[132px] text-sm"
          value={currentTo}
          onChange={(e) => push({ to: e.target.value })}
        />
      </div>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 px-2 text-muted-foreground"
          onClick={() => router.push(pathname)}
        >
          <X className="w-3.5 h-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  )
}
