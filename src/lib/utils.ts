import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—"
  // Parse YYYY-MM-DD as local time — new Date("YYYY-MM-DD") assumes UTC and shifts the day back in US timezones
  const d = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(date + "T12:00:00")
    : new Date(date)
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d)
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "")
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

export function calcProfitMargin(revenue: number, expenses: number): number {
  if (revenue === 0) return 0
  return Math.round(((revenue - expenses) / revenue) * 100)
}

export function getTodayLA(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date())
}
