export const PM_LABEL_WIDTH     = 180
export const GRID_START_HOUR    = 6
export const GRID_END_HOUR      = 21
export const HOUR_WIDTH         = 120
export const SLOT_WIDTH         = 30   // HOUR_WIDTH / 4 → one 15-min slot
export const SLIM_JOB_HEIGHT    = 38
export const REMINDER_HEIGHT    = 46
export const JOB_GAP            = 4
export const ROW_V_PADDING      = 8
export const TIME_HEADER_HEIGHT = 44
export const DRAG_OVERLAY_WIDTH = 220

export function timeToX(time: string | null): number {
  if (!time) return 0
  const [h, m] = time.split(":").map(Number)
  const minutesFromStart = h * 60 + m - GRID_START_HOUR * 60
  return Math.max(0, minutesFromStart * (HOUR_WIDTH / 60))
}

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
