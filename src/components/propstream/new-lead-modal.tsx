"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { CustomerForm } from "@/components/customers/customer-form"
import { Loader2, Phone } from "lucide-react"

interface PmOption { id: string; name: string; color: string }

interface Prefill {
  name?:        string
  phone?:       string
  email?:       string
  address?:     string
  notes?:       string
  lead_source?: string
}

interface Props {
  open:               boolean
  onClose:            () => void
  onSaved?:           () => void
  callActive?:        boolean
  prefill:            Prefill
  propstreamLeadId?:  string
  propstreamPhoneId?: string
}

export function NewLeadModal({
  open, onClose, onSaved, callActive,
  prefill, propstreamLeadId, propstreamPhoneId,
}: Props) {
  const [userId,  setUserId]  = useState<string | null>(null)
  const [pms,     setPms]     = useState<PmOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    const supabase = createClient()
    Promise.all([
      supabase.auth.getUser(),
      supabase.from("project_managers").select("id, name, color").eq("is_active", true).order("name"),
    ]).then(([{ data: { user } }, { data: pmsData }]) => {
      setUserId(user?.id ?? null)
      setPms(pmsData ?? [])
      setLoading(false)
    })
  }, [open])

  function handleSuccess() {
    onSaved?.()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose() }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Add New Lead
            {callActive && (
              <span className="flex items-center gap-1.5 text-sm font-normal text-green-600 dark:text-green-400">
                <Phone className="w-3.5 h-3.5 animate-pulse" />
                Call in progress
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        {loading || !userId ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <CustomerForm
            userId={userId}
            prefill={prefill}
            propstreamLeadId={propstreamLeadId}
            propstreamPhoneId={propstreamPhoneId}
            onSuccess={handleSuccess}
            onCancel={onClose}
            showStatus
            pms={pms}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
