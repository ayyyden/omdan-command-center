"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Copy, Check } from "lucide-react"

interface Appointment {
  scheduled_date: string
  start_time: string | null
  end_time: string | null
  project_summary: string | null
  assigned_pm: { name: string; phone: string | null } | null
}

interface CopyButtonsProps {
  customer: { name: string; phone: string | null; address: string | null; service_type?: string | null }
  appointment: Appointment | null
  company: { company_name: string | null; phone: string | null } | null
}

function formatApptDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00")
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

function formatTime12(t: string | null): string {
  if (!t) return ""
  const [h, m] = t.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function buildPmText(customer: CopyButtonsProps["customer"], appt: Appointment): string {
  const lines: string[] = []
  lines.push(`📋 Lead Appointment — ${customer.name}`)
  if (customer.address) lines.push(`📍 ${customer.address}`)
  if (customer.phone)   lines.push(`📞 ${customer.phone}`)
  lines.push(`📅 ${formatApptDate(appt.scheduled_date)}`)
  const timeStr = appt.start_time
    ? appt.end_time
      ? `${formatTime12(appt.start_time)} – ${formatTime12(appt.end_time)}`
      : formatTime12(appt.start_time)
    : null
  if (timeStr) lines.push(`⏰ ${timeStr}`)
  const project = appt.project_summary || customer.service_type
  if (project) lines.push(`🔧 ${project}`)
  return lines.join("\n")
}

function buildCustomerText(
  customer: CopyButtonsProps["customer"],
  appt: Appointment,
  company: CopyButtonsProps["company"],
): string {
  const firstName = customer.name.split(" ")[0]
  const companyName = company?.company_name ?? "Omdan Development"
  const companyPhone = company?.phone ?? "(951) 292-0703"
  const dateStr = formatApptDate(appt.scheduled_date)
  const timeStr = appt.start_time ? ` at ${formatTime12(appt.start_time)}` : ""
  return `Hi ${firstName}! This is ${companyName} confirming your free on-site estimate for ${dateStr}${timeStr}. We'll be heading your way — please reply YES to confirm or call/text us at ${companyPhone}. See you soon! 🏡`
}

export function CopyButtons({ customer, appointment, company }: CopyButtonsProps) {
  const [copiedPm, setCopiedPm] = useState(false)
  const [copiedCustomer, setCopiedCustomer] = useState(false)

  if (!appointment) return null

  function handleCopyPm() {
    const text = buildPmText(customer, appointment!)
    navigator.clipboard.writeText(text).then(() => {
      setCopiedPm(true)
      setTimeout(() => setCopiedPm(false), 2000)
    })
  }

  function handleCopyCustomer() {
    const text = buildCustomerText(customer, appointment!, company)
    navigator.clipboard.writeText(text).then(() => {
      setCopiedCustomer(true)
      setTimeout(() => setCopiedCustomer(false), 2000)
    })
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={handleCopyPm} className="gap-1.5">
        {copiedPm ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{copiedPm ? "Copied!" : "Copy for PM"}</span>
        <span className="sm:hidden">{copiedPm ? "✓" : "PM"}</span>
      </Button>
      <Button variant="outline" size="sm" onClick={handleCopyCustomer} className="gap-1.5">
        {copiedCustomer ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">{copiedCustomer ? "Copied!" : "Copy for Customer"}</span>
        <span className="sm:hidden">{copiedCustomer ? "✓" : "Cust."}</span>
      </Button>
    </>
  )
}
