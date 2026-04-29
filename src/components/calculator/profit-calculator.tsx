"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { formatCurrency, cn } from "@/lib/utils"

export interface JobOption {
  id: string
  title: string
  totalSell: number
  recordedExpenses?: {
    materials: number
    labor: number
    other: number
  }
}

interface ProfitCalculatorProps {
  jobs: JobOption[]
  isAdmin: boolean
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""))
  return isNaN(n) ? 0 : Math.max(0, n)
}

function DollarInput({
  value,
  onChange,
  placeholder = "0.00",
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">
        $
      </span>
      <Input
        className="pl-7"
        type="number"
        min="0"
        step="0.01"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function PctInput({
  value,
  onChange,
  computed,
  base,
}: {
  value: string
  onChange: (v: string) => void
  computed: number
  base: number
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-1">
        <Input
          type="number"
          min="0"
          max="100"
          step="0.1"
          placeholder="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-8"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none select-none">
          %
        </span>
      </div>
      {base > 0 && computed > 0 && (
        <span className="text-sm text-muted-foreground tabular-nums min-w-[88px] text-right">
          {formatCurrency(computed)}
        </span>
      )}
    </div>
  )
}

function SummaryRow({
  label,
  value,
  minus,
  bold,
  showZero,
  valueClass,
}: {
  label: string
  value: number
  minus?: boolean
  bold?: boolean
  showZero?: boolean
  valueClass?: string
}) {
  if (!showZero && value === 0) return null
  return (
    <div className="flex items-center justify-between text-sm gap-4">
      <span className={bold ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={cn("tabular-nums", valueClass ?? (minus ? "text-destructive" : bold ? "font-medium" : ""))}>
        {minus ? `−${formatCurrency(value)}` : formatCurrency(value)}
      </span>
    </div>
  )
}

const NO_JOB = "__none__"

export function ProfitCalculator({ jobs, isAdmin }: ProfitCalculatorProps) {
  const [selectedJobId, setSelectedJobId] = useState(NO_JOB)
  const [totalSell, setTotalSell] = useState("")
  const [sellSource, setSellSource] = useState<"empty" | "job" | "custom">("empty")
  const [leadCostPct, setLeadCostPct] = useState("")
  const [materials, setMaterials] = useState("")
  const [labor, setLabor] = useState("")
  const [other, setOther] = useState("")
  const [bizProfitPct, setBizProfitPct] = useState("")

  // Recorded job expenses for admin+ when a job is selected
  const [recordedExp, setRecordedExp] = useState<{ materials: number; labor: number; other: number } | null>(null)

  function handleJobSelect(jobId: string) {
    setSelectedJobId(jobId)
    if (jobId === NO_JOB) {
      setSellSource("empty")
      setTotalSell("")
      setRecordedExp(null)
      return
    }
    const job = jobs.find((j) => j.id === jobId)
    if (!job) return
    const sell = job.totalSell > 0 ? job.totalSell.toFixed(2) : ""
    setTotalSell(sell)
    setSellSource(sell ? "job" : "empty")
    setRecordedExp(isAdmin && job.recordedExpenses ? job.recordedExpenses : null)
  }

  function handleTotalSellChange(v: string) {
    setTotalSell(v)
    if (selectedJobId !== NO_JOB) {
      const job = jobs.find((j) => j.id === selectedJobId)
      const jobSell = job?.totalSell ?? 0
      setSellSource(parseNum(v) === jobSell ? "job" : "custom")
    }
  }

  // --- Calculations ---
  const sell = parseNum(totalSell)
  const leadPct = Math.min(100, parseNum(leadCostPct))
  const mat = parseNum(materials)
  const lab = parseNum(labor)
  const oth = parseNum(other)
  const bizPct = Math.min(100, parseNum(bizProfitPct))

  const leadAmount = sell * leadPct / 100
  const manualExpenses = mat + lab + oth
  const recTotal = recordedExp ? recordedExp.materials + recordedExp.labor + recordedExp.other : 0
  const remaining = sell - leadAmount - manualExpenses - recTotal
  const bizAmount = remaining * bizPct / 100
  const totalLeft = remaining - bizAmount

  const hasValues = sell > 0

  return (
    <div className="space-y-5 max-w-lg">
      {/* Job selector */}
      {jobs.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-sm">Job (optional)</Label>
          <Select value={selectedJobId} onValueChange={handleJobSelect}>
            <SelectTrigger>
              <SelectValue placeholder="No job selected" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_JOB}>No job selected</SelectItem>
              {jobs.map((j) => (
                <SelectItem key={j.id} value={j.id}>
                  {j.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Total Sell */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>Total Sell</Label>
          {sellSource === "job" && (
            <span className="text-xs text-muted-foreground">From selected job</span>
          )}
          {sellSource === "custom" && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Custom total</span>
          )}
        </div>
        <DollarInput value={totalSell} onChange={handleTotalSellChange} />
      </div>

      <Separator />

      {/* Lead Cost */}
      <div className="space-y-1.5">
        <Label>Lead Cost %</Label>
        <PctInput
          value={leadCostPct}
          onChange={setLeadCostPct}
          computed={leadAmount}
          base={sell}
        />
      </div>

      {/* Manual expenses */}
      <div className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Expenses</p>
        {(
          [
            { label: "Materials", value: materials, set: setMaterials },
            { label: "Labor", value: labor, set: setLabor },
            { label: "Other", value: other, set: setOther },
          ] as const
        ).map(({ label, value, set }) => (
          <div key={label} className="space-y-1.5">
            <Label>{label}</Label>
            <DollarInput value={value} onChange={set} />
          </div>
        ))}
      </div>

      {/* Recorded job expenses — admin+ only */}
      {isAdmin && recordedExp && recTotal > 0 && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recorded Job Expenses
          </p>
          {recordedExp.materials > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Materials</span>
              <span className="tabular-nums">{formatCurrency(recordedExp.materials)}</span>
            </div>
          )}
          {recordedExp.labor > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Labor</span>
              <span className="tabular-nums">{formatCurrency(recordedExp.labor)}</span>
            </div>
          )}
          {recordedExp.other > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Other</span>
              <span className="tabular-nums">{formatCurrency(recordedExp.other)}</span>
            </div>
          )}
          <div className="flex justify-between text-sm font-medium pt-1 border-t border-border">
            <span>Total Recorded</span>
            <span className="text-destructive tabular-nums">−{formatCurrency(recTotal)}</span>
          </div>
        </div>
      )}

      <Separator />

      {/* Business Profit */}
      <div className="space-y-1.5">
        <Label>Business Profit %</Label>
        <p className="text-xs text-muted-foreground">
          Calculated from remaining after lead cost and expenses
        </p>
        <PctInput
          value={bizProfitPct}
          onChange={setBizProfitPct}
          computed={bizAmount}
          base={remaining}
        />
      </div>

      {/* Summary card */}
      <Card
        className={cn(
          hasValues && totalLeft < 0
            ? "border-destructive/50"
            : hasValues
            ? "border-success/30"
            : ""
        )}
      >
        <CardContent className="pt-4 pb-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Summary
          </p>

          <SummaryRow label="Total Sell" value={sell} showZero bold={false} />
          {leadAmount > 0 && (
            <SummaryRow label={`Lead Cost (${leadPct}%)`} value={leadAmount} minus />
          )}
          {mat > 0 && <SummaryRow label="Materials" value={mat} minus />}
          {lab > 0 && <SummaryRow label="Labor" value={lab} minus />}
          {oth > 0 && <SummaryRow label="Other" value={oth} minus />}
          {isAdmin && recTotal > 0 && (
            <SummaryRow label="Recorded Job Expenses" value={recTotal} minus />
          )}

          <div className="border-t border-border pt-2 mt-1">
            <SummaryRow
              label="Remaining Before Business Profit"
              value={hasValues ? remaining : 0}
              bold
              showZero
            />
          </div>

          {bizAmount > 0 && (
            <SummaryRow
              label={`Business Profit (${bizPct}%)`}
              value={bizAmount}
              minus
              valueClass="text-amber-600 dark:text-amber-400"
            />
          )}

          <div className="border-t border-border pt-2 mt-1">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">Total Left</span>
              <span
                className={cn(
                  "text-xl font-bold tabular-nums",
                  !hasValues
                    ? "text-muted-foreground"
                    : totalLeft >= 0
                    ? "text-success"
                    : "text-destructive"
                )}
              >
                {hasValues ? formatCurrency(totalLeft) : "—"}
              </span>
            </div>
            {hasValues && totalLeft < 0 && (
              <p className="text-xs text-destructive mt-1">
                Over budget by {formatCurrency(-totalLeft)}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
