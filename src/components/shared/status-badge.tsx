import { Badge } from "@/components/ui/badge"
import type { LeadStatus, JobStatus, EstimateStatus } from "@/types"

const leadStatusConfig: Record<LeadStatus, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "muted"; label: string }> = {
  "New Lead":          { variant: "muted",       label: "New Lead" },
  "Contacted":         { variant: "secondary",   label: "Contacted" },
  "Estimate Sent":     { variant: "default",     label: "Est. Sent" },
  "Follow-Up Needed":  { variant: "warning",     label: "Follow-Up" },
  "Approved":          { variant: "success",     label: "Approved" },
  "Scheduled":         { variant: "default",     label: "Scheduled" },
  "In Progress":       { variant: "default",     label: "In Progress" },
  "Completed":         { variant: "success",     label: "Completed" },
  "Paid":              { variant: "success",     label: "Paid" },
  "Closed Lost":       { variant: "destructive", label: "Closed Lost" },
}

const jobStatusConfig: Record<JobStatus, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "muted"; label: string }> = {
  scheduled:   { variant: "default",     label: "Scheduled" },
  in_progress: { variant: "warning",     label: "In Progress" },
  completed:   { variant: "success",     label: "Completed" },
  on_hold:     { variant: "muted",       label: "On Hold" },
  cancelled:   { variant: "destructive", label: "Cancelled" },
}

const estimateStatusConfig: Record<EstimateStatus, { variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning" | "muted"; label: string }> = {
  draft:    { variant: "muted",       label: "Draft" },
  sent:     { variant: "default",     label: "Sent" },
  approved: { variant: "success",     label: "Approved" },
  rejected: { variant: "destructive", label: "Rejected" },
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const config = leadStatusConfig[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const config = jobStatusConfig[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}

export function EstimateStatusBadge({ status }: { status: EstimateStatus }) {
  const config = estimateStatusConfig[status]
  return <Badge variant={config.variant}>{config.label}</Badge>
}
