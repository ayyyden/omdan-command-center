import { ROLE_LABELS, ROLE_COLORS } from "@/lib/permissions"
import type { TeamRole } from "@/lib/permissions"
import { cn } from "@/lib/utils"

interface Props {
  role: string
  className?: string
}

export function RoleBadge({ role, className }: Props) {
  const color = ROLE_COLORS[role as TeamRole] ?? "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
  const label = ROLE_LABELS[role as TeamRole] ?? role.replace(/_/g, " ")
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap", color, className)}>
      {label}
    </span>
  )
}
