"use client"

import { useState, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { formatCurrency, cn } from "@/lib/utils"
import { Plus, X } from "lucide-react"

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

interface ChangeOrder {
  id: string
  totalSell: string
  leadCostPct: string
  cost: string
  bizProfitPct: string
}

interface ProfitCalculatorProps {
  jobs: JobOption[]
  isAdmin: boolean
}

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/[^0-9.-]/g, ""))
  return isNaN(n) ? 0 : Math.max(0, n)
}

function uid() {
  return Math.random().toString(36).slice(2, 9)
}

function DollarInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
        placeholder="0.00"
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
      <span className={cn("tabular-nums shrink-0", valueClass ?? (minus ? "text-destructive" : bold ? "font-medium" : ""))}>
        {minus ? `−${formatCurrency(value)}` : formatCurrency(value)}
      </span>
    </div>
  )
}

function TotalLeftRow({ label, value, hasValues }: { label: string; value: number; hasValues: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-bold text-sm">{label}</span>
      <span
        className={cn(
          "text-xl font-bold tabular-nums",
          !hasValues ? "text-muted-foreground" : value >= 0 ? "text-success" : "text-destructive"
        )}
      >
        {hasValues ? formatCurrency(value) : "—"}
      </span>
    </div>
  )
}

function calcCO(co: ChangeOrder) {
  const sell = parseNum(co.totalSell)
  const leadPct = Math.min(100, parseNum(co.leadCostPct))
  const costVal = parseNum(co.cost)
  const bizPct = Math.min(100, parseNum(co.bizProfitPct))
  const leadAmount = sell * leadPct / 100
  const remaining = sell - leadAmount - costVal
  const bizAmount = remaining * bizPct / 100
  const totalLeft = remaining - bizAmount
  return { sell, leadPct, costVal, bizPct, leadAmount, remaining, bizAmount, totalLeft, hasValues: sell > 0 }
}

const NO_JOB = "__none__"

export function ProfitCalculator({ jobs, isAdmin }: ProfitCalculatorProps) {
  // --- Main job state ---
  const [selectedJobId, setSelectedJobId] = useState(NO_JOB)
  const [totalSell, setTotalSell] = useState("")
  const [sellSource, setSellSource] = useState<"empty" | "job" | "custom">("empty")
  const [leadCostPct, setLeadCostPct] = useState("")
  const [cost, setCost] = useState("")
  const [bizProfitPct, setBizProfitPct] = useState("")
  const [recordedExp, setRecordedExp] = useState<{ materials: number; labor: number; other: number } | null>(null)

  // --- Change orders state ---
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([
    { id: uid(), totalSell: "", leadCostPct: "", cost: "", bizProfitPct: "" },
  ])

  const addChangeOrder = useCallback(() => {
    setChangeOrders((prev) => [
      ...prev,
      { id: uid(), totalSell: "", leadCostPct: "", cost: "", bizProfitPct: "" },
    ])
  }, [])

  const removeChangeOrder = useCallback((id: string) => {
    setChangeOrders((prev) => prev.filter((co) => co.id !== id))
  }, [])

  const updateCO = useCallback((id: string, field: keyof Omit<ChangeOrder, "id">, value: string) => {
    setChangeOrders((prev) =>
      prev.map((co) => (co.id === id ? { ...co, [field]: value } : co))
    )
  }, [])

  // --- Job select handlers ---
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
      setSellSource(parseNum(v) === (job?.totalSell ?? 0) ? "job" : "custom")
    }
  }

  // --- Main calculations ---
  const sell = parseNum(totalSell)
  const leadPct = Math.min(100, parseNum(leadCostPct))
  const costVal = parseNum(cost)
  const bizPct = Math.min(100, parseNum(bizProfitPct))
  const leadAmount = sell * leadPct / 100
  const recTotal = recordedExp ? recordedExp.materials + recordedExp.labor + recordedExp.other : 0
  const remaining = sell - leadAmount - costVal - recTotal
  const bizAmount = remaining * bizPct / 100
  const mainTotalLeft = remaining - bizAmount
  const mainHasValues = sell > 0

  // --- Change order calculations ---
  const coCalcs = changeOrders.map((co) => ({ ...co, ...calcCO(co) }))
  const coTotalLeftSum = coCalcs.reduce((s, co) => s + (co.hasValues ? co.totalLeft : 0), 0)
  const anyCoHasValues = coCalcs.some((co) => co.hasValues)

  // --- Combined ---
  const combinedHasValues = mainHasValues || anyCoHasValues
  const combinedTotalLeft = (mainHasValues ? mainTotalLeft : 0) + coTotalLeftSum

  return (
    <div className="space-y-6 max-w-lg">

      {/* ── Main Job Calculator ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Job Calculator</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                    <SelectItem key={j.id} value={j.id}>{j.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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

          <div className="space-y-1.5">
            <Label>Lead Cost %</Label>
            <PctInput value={leadCostPct} onChange={setLeadCostPct} computed={leadAmount} base={sell} />
          </div>

          <div className="space-y-1.5">
            <Label>Cost</Label>
            <DollarInput value={cost} onChange={setCost} />
          </div>

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

          <div className="space-y-1.5">
            <Label>Business Profit %</Label>
            <p className="text-xs text-muted-foreground">Applied to remaining after lead cost and expenses</p>
            <PctInput value={bizProfitPct} onChange={setBizProfitPct} computed={bizAmount} base={remaining} />
          </div>

          <Separator />

          <div className="space-y-2">
            <SummaryRow label="Total Sell" value={sell} showZero />
            {leadAmount > 0 && <SummaryRow label={`Lead Cost (${leadPct}%)`} value={leadAmount} minus />}
            {costVal > 0 && <SummaryRow label="Cost" value={costVal} minus />}
            {isAdmin && recTotal > 0 && (
              <SummaryRow label="Recorded Job Expenses" value={recTotal} minus />
            )}
            <div className="border-t border-border pt-2">
              <SummaryRow label="Remaining Before Business Profit" value={mainHasValues ? remaining : 0} bold showZero />
            </div>
            {bizAmount > 0 && (
              <SummaryRow
                label={`Business Profit (${bizPct}%)`}
                value={bizAmount}
                minus
                valueClass="text-amber-600 dark:text-amber-400"
              />
            )}
            <div className="border-t border-border pt-2">
              <TotalLeftRow label="Job Total Left" value={mainTotalLeft} hasValues={mainHasValues} />
              {mainHasValues && mainTotalLeft < 0 && (
                <p className="text-xs text-destructive mt-1">Over budget by {formatCurrency(-mainTotalLeft)}.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Change Order Cards ── */}
      {coCalcs.map((co, index) => (
        <Card key={co.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                Change Order {changeOrders.length > 1 ? index + 1 : ""}
              </CardTitle>
              {changeOrders.length > 1 && (
                <button
                  onClick={() => removeChangeOrder(co.id)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  aria-label="Remove change order"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Total Sell</Label>
              <DollarInput value={co.totalSell} onChange={(v) => updateCO(co.id, "totalSell", v)} />
            </div>

            <div className="space-y-1.5">
              <Label>Lead Cost %</Label>
              <PctInput
                value={co.leadCostPct}
                onChange={(v) => updateCO(co.id, "leadCostPct", v)}
                computed={co.leadAmount}
                base={co.sell}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Cost</Label>
              <DollarInput value={co.cost} onChange={(v) => updateCO(co.id, "cost", v)} />
            </div>

            <div className="space-y-1.5">
              <Label>Business Profit %</Label>
              <p className="text-xs text-muted-foreground">Applied to remaining after lead cost and expenses</p>
              <PctInput
                value={co.bizProfitPct}
                onChange={(v) => updateCO(co.id, "bizProfitPct", v)}
                computed={co.bizAmount}
                base={co.remaining}
              />
            </div>

            <Separator />

            <div className="space-y-2">
              <SummaryRow label="Change Order Total Sell" value={co.sell} showZero />
              {co.leadAmount > 0 && <SummaryRow label={`Lead Cost (${co.leadPct}%)`} value={co.leadAmount} minus />}
              {co.costVal > 0 && <SummaryRow label="Cost" value={co.costVal} minus />}
              <div className="border-t border-border pt-2">
                <SummaryRow label="Remaining Before Business Profit" value={co.hasValues ? co.remaining : 0} bold showZero />
              </div>
              {co.bizAmount > 0 && (
                <SummaryRow
                  label={`Business Profit (${co.bizPct}%)`}
                  value={co.bizAmount}
                  minus
                  valueClass="text-amber-600 dark:text-amber-400"
                />
              )}
              <div className="border-t border-border pt-2">
                <TotalLeftRow label="Change Order Total Left" value={co.totalLeft} hasValues={co.hasValues} />
                {co.hasValues && co.totalLeft < 0 && (
                  <p className="text-xs text-destructive mt-1">Over budget by {formatCurrency(-co.totalLeft)}.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Add another CO button */}
      <Button
        variant="outline"
        className="w-full"
        onClick={addChangeOrder}
      >
        <Plus className="w-4 h-4 mr-2" />
        Add Another Change Order
      </Button>

      {/* ── Combined Summary ── */}
      <Card className={cn(
        combinedHasValues && combinedTotalLeft < 0
          ? "border-destructive/50"
          : combinedHasValues
          ? "border-success/30"
          : ""
      )}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Combined Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <SummaryRow label="Job Total Left" value={mainHasValues ? mainTotalLeft : 0} showZero />
          {coCalcs.map((co, index) => (
            <SummaryRow
              key={co.id}
              label={changeOrders.length > 1 ? `Change Order ${index + 1} Total Left` : "Change Order Total Left"}
              value={co.hasValues ? co.totalLeft : 0}
              showZero
            />
          ))}
          <div className="border-t border-border pt-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-sm">Combined Total Left</span>
              <span
                className={cn(
                  "text-2xl font-bold tabular-nums",
                  !combinedHasValues
                    ? "text-muted-foreground"
                    : combinedTotalLeft >= 0
                    ? "text-success"
                    : "text-destructive"
                )}
              >
                {combinedHasValues ? formatCurrency(combinedTotalLeft) : "—"}
              </span>
            </div>
            {combinedHasValues && combinedTotalLeft < 0 && (
              <p className="text-xs text-destructive mt-1">
                Combined is over budget by {formatCurrency(-combinedTotalLeft)}.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
