"use client"

import { useState, useRef } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChevronDown, X, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

export const SERVICE_TYPE_PRESETS = [
  "Artificial Grass", "Pavers", "Concrete", "Bathroom", "Roof",
  "Windows", "Gutters", "Gravel", "DG", "White Rocks", "Paint",
  "Refinish", "Kitchen",
] as const

/** Parse a comma-separated string into an array of trimmed non-empty values. */
export function parseServiceTypes(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(",").map((s) => s.trim()).filter(Boolean)
}

/** Join an array back to a comma-separated string. */
export function joinServiceTypes(types: string[]): string {
  return types.join(", ")
}

interface Props {
  value:     string        // comma-separated
  onChange:  (v: string) => void
  className?: string
}

export function ServiceTypeMultiSelect({ value, onChange, className }: Props) {
  const [open, setOpen]           = useState(false)
  const [customInput, setCustomInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = parseServiceTypes(value)

  function toggle(item: string) {
    const next = selected.includes(item)
      ? selected.filter((s) => s !== item)
      : [...selected, item]
    onChange(joinServiceTypes(next))
  }

  function removeItem(item: string) {
    onChange(joinServiceTypes(selected.filter((s) => s !== item)))
  }

  function addCustom() {
    const trimmed = customInput.trim()
    if (!trimmed || selected.includes(trimmed)) { setCustomInput(""); return }
    onChange(joinServiceTypes([...selected, trimmed]))
    setCustomInput("")
    inputRef.current?.focus()
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between h-auto min-h-9 px-3 py-2 font-normal",
            !selected.length && "text-muted-foreground",
            className,
          )}
        >
          {selected.length === 0 ? (
            <span>Select service types…</span>
          ) : (
            <div className="flex flex-wrap gap-1 mr-2">
              {selected.map((s) => (
                <Badge
                  key={s}
                  variant="secondary"
                  className="text-xs py-0 pl-2 pr-1 gap-0.5"
                  onClick={(e) => { e.stopPropagation(); removeItem(s) }}
                >
                  {s}
                  <X className="w-3 h-3 cursor-pointer" />
                </Badge>
              ))}
            </div>
          )}
          <ChevronDown className="w-4 h-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[--radix-popover-trigger-width] p-2" align="start">
        <div className="max-h-64 overflow-y-auto space-y-0.5">
          {SERVICE_TYPE_PRESETS.map((preset) => {
            const checked = selected.includes(preset)
            return (
              <button
                key={preset}
                type="button"
                onClick={() => toggle(preset)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-2 py-1.5 rounded text-sm text-left hover:bg-muted transition-colors",
                  checked && "bg-muted",
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded border shrink-0 flex items-center justify-center",
                    checked
                      ? "bg-primary border-primary text-primary-foreground"
                      : "border-input",
                  )}
                >
                  {checked && (
                    <svg viewBox="0 0 12 12" className="w-3 h-3 fill-current">
                      <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                {preset}
              </button>
            )
          })}
        </div>

        {/* Custom entry */}
        <div className="mt-2 pt-2 border-t flex gap-1.5">
          <Input
            ref={inputRef}
            placeholder="Other (type your own)…"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom() } }}
            className="h-8 text-sm"
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8 shrink-0"
            onClick={addCustom}
            disabled={!customInput.trim()}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
