"use client"

import Link from "next/link"
import { SLIM_JOB_HEIGHT, JOB_GAP, ROW_V_PADDING, HOUR_WIDTH, SLOT_WIDTH, GRID_START_HOUR, GRID_END_HOUR } from "./scheduler-constants"

const TOTAL_GRID_WIDTH = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_WIDTH
import type { LeadAppointment } from "./scheduler-client"

const LEAD_COLOR = "#0D9488" // teal-600

function formatTime12(time: string | null): string {
  if (!time) return ""
  const [h, m] = time.split(":").map(Number)
  const period = h >= 12 ? "PM" : "AM"
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`
}

function timeToX(time: string | null): number {
  if (!time) return 0
  const [h, m] = time.split(":").map(Number)
  const minutesFromStart = h * 60 + m - GRID_START_HOUR * 60
  return Math.max(0, minutesFromStart * (HOUR_WIDTH / 60))
}

interface LeadBlockProps {
  appt:       LeadAppointment
  index:      number
  onAssignPm: (appt: LeadAppointment) => void
}

export function LeadBlock({ appt, index, onAssignPm }: LeadBlockProps) {
  const xPos = timeToX(appt.start_time)

  // Width: span start→end if both present, else 2 slots (60min default)
  let blockWidth: number
  if (appt.start_time && appt.end_time) {
    const xEnd = timeToX(appt.end_time)
    blockWidth = Math.max(SLOT_WIDTH * 2, xEnd - xPos)
  } else {
    blockWidth = SLOT_WIDTH * 4 // 60min default
  }
  blockWidth = Math.min(blockWidth, TOTAL_GRID_WIDTH - xPos)

  const isNarrow = blockWidth < 80
  const timeLabel =
    appt.start_time && appt.end_time
      ? `${formatTime12(appt.start_time)} – ${formatTime12(appt.end_time)}`
      : formatTime12(appt.start_time)

  const href = appt.customer_id ? `/customers/${appt.customer_id}` : "#"

  const STATUS_COLORS: Record<string, string> = {
    scheduled:       "#0D9488",
    visited:         "#7C3AED",
    estimate_needed: "#D97706",
    estimate_sent:   "#2563EB",
    no_show:         "#DC2626",
    converted:       "#16A34A",
    cancelled:       "#6B7280",
  }
  const accent = STATUS_COLORS[appt.status] ?? LEAD_COLOR
  const pmColor = appt.assigned_pm?.color ?? null

  return (
    <div
      title={[appt.customer?.name, appt.project_summary, appt.city].filter(Boolean).join(" · ")}
      style={{
        position: "absolute",
        left: xPos,
        top: ROW_V_PADDING + index * (SLIM_JOB_HEIGHT + JOB_GAP),
        width: blockWidth,
        height: SLIM_JOB_HEIGHT,
        backgroundColor: `${accent}1A`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
        display: "flex",
        alignItems: "stretch",
        zIndex: 2,
        overflow: "hidden",
      }}
    >
      {/* Main link area */}
      <Link
        href={href}
        style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", paddingLeft: 8, paddingRight: pmColor ? 20 : 8, textDecoration: "none", overflow: "hidden" }}
      >
        <span
          className="font-semibold truncate leading-tight"
          style={{ fontSize: isNarrow ? 9 : 11, color: "var(--foreground)" }}
        >
          {appt.customer?.name ?? "Lead"}
          {appt.partner_reference ? ` #${appt.partner_reference}` : ""}
        </span>
        {!isNarrow && (
          <span
            className="truncate leading-tight"
            style={{ fontSize: 9, color: accent, marginTop: 2, fontVariantNumeric: "tabular-nums" }}
          >
            {[appt.project_summary, timeLabel || appt.city].filter(Boolean).join(" · ")}
          </span>
        )}
      </Link>

      {/* PM assignment dot — always visible, shows assigned PM color or gray */}
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onAssignPm(appt) }}
        title={appt.assigned_pm ? `PM: ${appt.assigned_pm.name} — click to change` : "Assign PM"}
        style={{
          position: "absolute",
          top: 3,
          right: 4,
          width: 10,
          height: 10,
          borderRadius: "50%",
          backgroundColor: pmColor ?? "rgba(100,100,100,0.25)",
          border: pmColor ? `2px solid ${pmColor}88` : "1.5px dashed rgba(100,100,100,0.4)",
          cursor: "pointer",
          padding: 0,
          flexShrink: 0,
        }}
      />
    </div>
  )
}
