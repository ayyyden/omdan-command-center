"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { ChevronDown, ChevronUp, Settings2 } from "lucide-react"

// Template admin (upload, field placement, activate/deactivate, delete) is
// still needed but shouldn't be the first thing staff see — the Documents
// list above is the day-to-day surface now. Collapsed by default.
export function ManageTemplatesToggle({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-3">
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen((o) => !o)}>
        <Settings2 className="w-3.5 h-3.5" />
        Manage Templates
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </Button>
      {open && <div className="pt-1">{children}</div>}
    </div>
  )
}
