import { NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "No data"
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v)
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s
  }
  return [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ].join("\r\n")
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const sp     = req.nextUrl.searchParams
  const type   = sp.get("type") ?? ""
  const from   = sp.get("from") || null
  const to     = sp.get("to") || null
  const pm     = sp.get("pm") || null
  const status = sp.get("status") || null

  const today = new Date().toISOString().split("T")[0]
  let csv      = ""
  let filename = `${type}-${today}.csv`

  // ── Payments ────────────────────────────────────────────────────────────────
  if (type === "payments") {
    let q = supabase
      .from("payments")
      .select("date, amount, method, notes, customer:customers(name), job:jobs(title), invoice:invoices(type)")
      .order("date", { ascending: false })
    if (from) q = q.gte("date", from)
    if (to)   q = q.lte("date", to)
    const { data } = await q
    csv = toCSV(
      (data ?? []).map((p) => ({
        Date:           p.date,
        Customer:       (p.customer as any)?.name ?? "",
        Job:            (p.job as any)?.title ?? "",
        Amount:         Number(p.amount).toFixed(2),
        Method:         String(p.method).replace(/_/g, " "),
        "Invoice Type": (p.invoice as any)?.type ?? "",
        Notes:          p.notes ?? "",
      }))
    )
  }

  // ── Expenses (all / job-only / overhead-only) ────────────────────────────────
  else if (type === "expenses" || type === "job_expenses" || type === "overhead_expenses") {
    let q = supabase
      .from("expenses")
      .select("date, expense_type, category, description, amount, notes, job:jobs(title)")
      .order("date", { ascending: false })
    if (from) q = q.gte("date", from)
    if (to)   q = q.lte("date", to)
    if (type === "job_expenses")      q = q.eq("expense_type", "job")
    if (type === "overhead_expenses") q = q.eq("expense_type", "business")
    const { data } = await q
    csv = toCSV(
      (data ?? []).map((e) => ({
        Date:        e.date,
        Type:        (e as any).expense_type === "business" ? "Business / Overhead" : "Job",
        Category:    String(e.category).replace(/_/g, " "),
        Job:         (e.job as any)?.title ?? "",
        Description: e.description,
        Amount:      Number(e.amount).toFixed(2),
        Notes:       (e as any).notes ?? "",
      }))
    )
  }

  // ── Invoices ─────────────────────────────────────────────────────────────────
  else if (type === "invoices") {
    let q = supabase
      .from("invoices")
      .select("created_at, type, status, amount, due_date, notes, customer:customers(name), job:jobs(title), payments(amount)")
      .order("created_at", { ascending: false })
    if (from) q = q.gte("created_at", from)
    if (to)   q = q.lte("created_at", `${to}T23:59:59`)
    const { data } = await q
    csv = toCSV(
      (data ?? []).map((inv) => {
        const paid      = ((inv.payments ?? []) as { amount: unknown }[]).reduce((s, p) => s + Number(p.amount), 0)
        const remaining = Math.max(0, Number(inv.amount) - paid)
        return {
          Date:             inv.created_at.split("T")[0],
          Customer:         (inv.customer as any)?.name ?? "",
          Job:              (inv.job as any)?.title ?? "",
          Type:             String(inv.type),
          Status:           String(inv.status),
          Amount:           Number(inv.amount).toFixed(2),
          Paid:             paid.toFixed(2),
          Remaining:        remaining.toFixed(2),
          "Due Date":       inv.due_date ?? "",
          Notes:            inv.notes ?? "",
        }
      })
    )
  }

  // ── Job profit summary ───────────────────────────────────────────────────────
  else if (type === "job_profit") {
    let q = supabase
      .from("jobs")
      .select(`
        id, title, status,
        customer:customers(name),
        project_manager:project_managers(name),
        estimate:estimates(total),
        payments(amount),
        expenses(amount),
        invoices(amount),
        change_orders(amount, status)
      `)
      .neq("status", "cancelled")
    if (pm && pm !== "all")         q = q.eq("project_manager_id", pm)
    if (status && status !== "all") q = q.eq("status", status)
    const { data: jobs } = await q
    csv = toCSV(
      (jobs ?? []).map((job: any) => {
        const estimateTotal  = Number(job.estimate?.total ?? 0)
        const approvedCOs    = (job.change_orders ?? []).filter((co: any) => co.status === "approved").reduce((s: number, co: any) => s + Number(co.amount), 0)
        const contractValue  = estimateTotal + approvedCOs
        const collected      = (job.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
        const jobExpenses    = (job.expenses ?? []).reduce((s: number, e: any) => s + Number(e.amount), 0)
        const invoiced       = (job.invoices ?? []).reduce((s: number, i: any) => s + Number(i.amount), 0)
        const grossProfit    = collected - jobExpenses
        const unpaid         = Math.max(0, contractValue - collected)
        return {
          Job:                       job.title,
          Customer:                  job.customer?.name ?? "",
          PM:                        job.project_manager?.name ?? "",
          Status:                    String(job.status).replace(/_/g, " "),
          "Estimate Total":          estimateTotal.toFixed(2),
          "Approved Change Orders":  approvedCOs.toFixed(2),
          "Contract Value":          contractValue.toFixed(2),
          Invoiced:                  invoiced.toFixed(2),
          Collected:                 collected.toFixed(2),
          "Job Expenses":            jobExpenses.toFixed(2),
          "Gross Profit":            grossProfit.toFixed(2),
          "Unpaid Balance":          unpaid.toFixed(2),
        }
      })
    )
  }

  // ── Receipts ─────────────────────────────────────────────────────────────────
  else if (type === "receipts") {
    let q = supabase
      .from("receipts")
      .select("created_at, amount, note, file_path, job:jobs(title)")
      .order("created_at", { ascending: false })
    if (from) q = q.gte("created_at", from)
    if (to)   q = q.lte("created_at", `${to}T23:59:59`)
    const { data } = await q
    csv = toCSV(
      (data ?? []).map((r) => ({
        Date:        r.created_at.split("T")[0],
        Job:         (r.job as any)?.title ?? "",
        Amount:      r.amount !== null ? Number(r.amount).toFixed(2) : "",
        Note:        r.note ?? "",
        "File Path": r.file_path,
      }))
    )
  }

  else {
    return new Response("Unknown export type", { status: 400 })
  }

  return new Response(csv, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
