"use client"

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"

interface DataPoint {
  label: string
  revenue: number
  expenses: number
  profit: number
}

export function RevenueChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip
          formatter={(value, name) => [`$${Number(value).toLocaleString()}`, String(name).charAt(0).toUpperCase() + String(name).slice(1)]}
          contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", background: "var(--card)" }}
        />
        <Legend />
        <Bar dataKey="revenue" name="Revenue" fill="oklch(0.527 0.154 150.069)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="expenses" name="Expenses" fill="oklch(0.577 0.245 27.325)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="profit" name="Profit" fill="oklch(0.546 0.245 262.881)" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
