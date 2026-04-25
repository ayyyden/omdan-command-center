import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCurrency } from "@/lib/utils"
import Link from "next/link"

interface JobProfit {
  id: string
  title: string
  customer: string
  pm: { id: string; name: string; color: string } | null
  status: string
  estimateTotal: number
  totalPaid: number
  totalExpenses: number
  invoicedTotal: number
  grossProfit: number
  margin: number
  unpaid: number
}

const STATUS_LABEL: Record<string, string> = {
  scheduled:   "Scheduled",
  in_progress: "In Progress",
  completed:   "Completed",
  on_hold:     "On Hold",
  cancelled:   "Cancelled",
}

const STATUS_CLASS: Record<string, string> = {
  scheduled:   "bg-muted text-muted-foreground",
  in_progress: "bg-warning/10 text-warning border border-warning/30",
  completed:   "bg-success/10 text-success border border-success/30",
  on_hold:     "bg-muted text-muted-foreground",
  cancelled:   "bg-destructive/10 text-destructive border border-destructive/30",
}

export function JobProfitTable({ jobs }: { jobs: JobProfit[] }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground px-4 py-6">No job data for the selected filters.</p>
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-[160px]">Job</TableHead>
            <TableHead className="min-w-[120px]">Customer</TableHead>
            <TableHead className="min-w-[110px]">PM</TableHead>
            <TableHead className="min-w-[100px]">Status</TableHead>
            <TableHead className="min-w-[90px]">Estimate</TableHead>
            <TableHead className="min-w-[80px]">Invoiced</TableHead>
            <TableHead className="min-w-[80px]">Paid</TableHead>
            <TableHead className="min-w-[80px]">Expenses</TableHead>
            <TableHead className="min-w-[80px]">Profit</TableHead>
            <TableHead className="min-w-[70px]">Margin</TableHead>
            <TableHead className="min-w-[80px]">Unpaid</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>
                <Link href={`/jobs/${job.id}`} className="font-semibold hover:text-primary text-sm">
                  {job.title}
                </Link>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{job.customer}</TableCell>
              <TableCell>
                {job.pm ? (
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: job.pm.color }} />
                    <span className="text-sm">{job.pm.name}</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${STATUS_CLASS[job.status] ?? "bg-muted text-muted-foreground"}`}>
                  {STATUS_LABEL[job.status] ?? job.status}
                </span>
              </TableCell>
              <TableCell className="text-sm">{formatCurrency(job.estimateTotal)}</TableCell>
              <TableCell className="text-sm">{formatCurrency(job.invoicedTotal)}</TableCell>
              <TableCell className="text-sm font-medium text-success">{formatCurrency(job.totalPaid)}</TableCell>
              <TableCell className="text-sm text-destructive">{formatCurrency(job.totalExpenses)}</TableCell>
              <TableCell className={`text-sm font-semibold ${job.grossProfit >= 0 ? "text-success" : "text-destructive"}`}>
                {formatCurrency(job.grossProfit)}
              </TableCell>
              <TableCell>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
                  job.margin >= 30 ? "bg-success/10 text-success border border-success/30"
                  : job.margin >= 15 ? "bg-warning/10 text-warning border border-warning/30"
                  : "bg-destructive/10 text-destructive border border-destructive/30"
                }`}>
                  {job.margin}%
                </span>
              </TableCell>
              <TableCell className={`text-sm ${job.unpaid > 0 ? "text-warning font-medium" : "text-muted-foreground"}`}>
                {job.unpaid > 0 ? formatCurrency(job.unpaid) : "Paid"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
