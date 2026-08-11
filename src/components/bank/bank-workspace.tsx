"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PlaidLinkButton } from "@/components/bank/plaid-link-button"
import { useToast } from "@/hooks/use-toast"
import { formatCurrency, formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

interface BankAccount {
  id: string
  name: string
  official_name: string | null
  mask: string | null
  type: string | null
  subtype: string | null
  current_balance: number | null
  currency: string | null
}

interface Institution {
  id: string
  institution_name: string | null
  status: string
  error: string | null
  last_synced_at: string | null
  bank_accounts: BankAccount[]
}

interface Transaction {
  id: string
  bank_account_id: string
  amount: number
  date: string
  name: string
  merchant_name: string | null
  category: string | null
  pending: boolean
  match_status: "unmatched" | "suggested" | "confirmed" | "ignored"
  bank_accounts: { name: string; mask: string | null } | null
}

const MATCH_BADGE: Record<Transaction["match_status"], string> = {
  unmatched: "bg-gray-100 text-gray-700 dark:bg-gray-800/60 dark:text-gray-300",
  suggested: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  confirmed: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  ignored:   "bg-gray-100 text-gray-500 dark:bg-gray-800/40 dark:text-gray-500",
}

export function BankWorkspace() {
  const { toast } = useToast()
  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const loadAccounts = useCallback(async () => {
    const res = await fetch("/api/bank/accounts")
    const data = await res.json()
    setInstitutions(data.institutions ?? [])
  }, [])

  const loadTransactions = useCallback(async () => {
    const res = await fetch("/api/bank/transactions?limit=50")
    const data = await res.json()
    setTransactions(data.transactions ?? [])
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([loadAccounts(), loadTransactions()]).finally(() => setLoading(false))
  }, [loadAccounts, loadTransactions])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/bank/sync", { method: "POST" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? "Sync failed")
      const totalAdded = (data.results ?? []).reduce((sum: number, r: { added: number }) => sum + r.added, 0)
      toast({ title: `Sync complete — ${totalAdded} new transaction${totalAdded !== 1 ? "s" : ""}` })
      await Promise.all([loadAccounts(), loadTransactions()])
    } catch (err) {
      toast({ title: "Sync failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" })
    } finally {
      setSyncing(false)
    }
  }

  const allAccounts = institutions.flatMap((i) => i.bank_accounts)
  const totalBalance = allAccounts.reduce((sum, a) => sum + (a.current_balance ?? 0), 0)

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {allAccounts.length > 0
            ? `${allAccounts.length} account${allAccounts.length !== 1 ? "s" : ""} connected · ${formatCurrency(totalBalance)} total balance`
            : "No bank accounts connected yet"}
        </div>
        <div className="flex items-center gap-2">
          {institutions.length > 0 && (
            <Button variant="outline" onClick={handleSync} disabled={syncing}>
              <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
          <PlaidLinkButton onConnected={() => { loadAccounts(); loadTransactions() }} />
        </div>
      </div>

      {!loading && institutions.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Connect a bank account to see transactions here, and let Lia look them up and suggest matches to expenses and payments.
          </CardContent>
        </Card>
      )}

      {institutions.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {institutions.map((inst) => (
            <Card key={inst.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{inst.institution_name ?? "Bank"}</span>
                  {inst.status !== "active" && (
                    <Badge className="bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
                      {inst.status}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {inst.bank_accounts.map((acct) => (
                  <div key={acct.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {acct.name}{acct.mask ? ` ••${acct.mask}` : ""}
                    </span>
                    <span className="font-medium">
                      {acct.current_balance != null ? formatCurrency(acct.current_balance) : "—"}
                    </span>
                  </div>
                ))}
                {inst.error && <p className="text-xs text-red-600 mt-2">{inst.error}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {transactions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent transactions</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(tx.date)}</TableCell>
                    <TableCell>
                      {tx.merchant_name ?? tx.name}
                      {tx.pending && <span className="ml-2 text-xs text-muted-foreground">(pending)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {tx.bank_accounts ? `${tx.bank_accounts.name}${tx.bank_accounts.mask ? ` ••${tx.bank_accounts.mask}` : ""}` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tx.category ?? "—"}</TableCell>
                    <TableCell className={cn("text-right font-medium", tx.amount < 0 ? "text-green-600" : "text-foreground")}>
                      {tx.amount < 0 ? "+" : ""}{formatCurrency(Math.abs(tx.amount))}
                    </TableCell>
                    <TableCell>
                      <Badge className={MATCH_BADGE[tx.match_status]}>{tx.match_status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
