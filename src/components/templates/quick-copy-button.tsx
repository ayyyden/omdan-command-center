"use client"

import { useState } from "react"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Check, Copy, Loader2 } from "lucide-react"
import type { TemplateData } from "./use-template-button"
import { logCommunication } from "@/lib/log-communication"

interface TemplateShape {
  id: string
  name: string
  type: string
  subject: string | null
  body: string
}

function render(text: string, data: TemplateData): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => (data as Record<string, string>)[key] ?? `{{${key}}}`)
}

export interface LogContext {
  customerId?: string
  jobId?: string
  estimateId?: string
}

interface QuickCopyButtonProps {
  label: string
  templateType: string
  templates: TemplateShape[]
  data: TemplateData
  logContext?: LogContext
}

export function QuickCopyButton({ label, templateType, templates, data, logContext }: QuickCopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy]     = useState(false)
  const { toast } = useToast()

  async function handle() {
    const template = templates.find((t) => t.type === templateType)
    if (!template) {
      toast({
        title: "No template found",
        description: `Create a "${templateType.replace(/_/g, " ")}" template in Settings → Message Templates.`,
        variant: "destructive",
      })
      return
    }

    const body    = render(template.body, data)
    const subject = template.subject ? render(template.subject, data) : null
    const text    = subject ? `${subject}\n\n${body}` : body

    setBusy(true)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (templateType === "review_request") {
        toast({ title: "Review request copied", description: "Follow up with the customer in 2 days." })
      } else {
        toast({ title: `Copied: ${template.name}` })
      }
      setTimeout(() => setCopied(false), 2000)

      logCommunication({
        ...logContext,
        templateId: template.id,
        type:       template.type,
        subject,
        body,
      }).catch(() => {})
    } catch {
      toast({ title: "Copy failed — try manually", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handle} disabled={busy}>
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : copied ? (
        <Check className="w-3.5 h-3.5 text-success" />
      ) : (
        <Copy className="w-3.5 h-3.5" />
      )}
      {label}
    </Button>
  )
}
