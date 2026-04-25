"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { Trash2, Loader2 } from "lucide-react"

interface DeleteCustomerButtonProps {
  customerId: string
  customerName: string
}

export function DeleteCustomerButton({ customerId, customerName }: DeleteCustomerButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("customers").delete().eq("id", customerId)

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      setLoading(false)
      return
    }

    toast({ title: "Deleted", description: `${customerName} has been removed.` })
    router.push("/customers")
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="text-destructive hover:text-destructive">
          <Trash2 className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Customer</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{customerName}</strong>? This will also delete all related estimates, jobs, expenses, and payments. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" onClick={handleDelete} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
