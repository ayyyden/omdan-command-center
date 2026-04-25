"use client"

import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"

const COLORS = [
  "oklch(0.546 0.245 262.881)",
  "oklch(0.527 0.154 150.069)",
  "oklch(0.627 0.194 71.556)",
  "oklch(0.577 0.245 27.325)",
  "oklch(0.65 0.2 310)",
  "oklch(0.6 0.18 200)",
  "oklch(0.7 0.15 90)",
  "oklch(0.55 0.15 240)",
]

interface DataPoint {
  name: string
  value: number
}

export function ExpenseCategoryChart({ data }: { data: DataPoint[] }) {
  if (data.length === 0) {
    return <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground">No expense data</div>
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="45%"
          outerRadius={90}
          dataKey="value"
          label={({ name, percent }) => `${name ?? ""} ${(((percent as number | undefined) ?? 0) * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => [`$${Number(value).toLocaleString()}`, "Amount"]}
          contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)" }}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
