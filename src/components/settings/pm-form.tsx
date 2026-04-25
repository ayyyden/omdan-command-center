"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { projectManagerSchema, type ProjectManagerFormValues } from "@/lib/validations/project-manager"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog"
import { Loader2, Plus, Trash2, Archive, ArchiveRestore } from "lucide-react"
import type { ProjectManager } from "@/types"

const PM_COLOR_PRESETS = [
  "#F97316", // orange
  "#EF4444", // red
  "#3B82F6", // blue
  "#22C55E", // green
  "#A855F7", // purple
  "#EC4899", // pink
  "#F59E0B", // amber
  "#06B6D4", // cyan
  "#6B7280", // gray
]

interface PMFormDialogProps {
  pm?: ProjectManager
  userId: string
  trigger?: React.ReactNode
}

export function PMFormDialog({ pm, userId, trigger }: PMFormDialogProps) {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const form = useForm<ProjectManagerFormValues>({
    resolver: zodResolver(projectManagerSchema),
    defaultValues: {
      name: pm?.name ?? "",
      phone: pm?.phone ?? "",
      email: pm?.email ?? "",
      is_active: pm?.is_active ?? true,
      color: pm?.color ?? "#6B7280",
    },
  })

  async function onSubmit(values: ProjectManagerFormValues) {
    const supabase = createClient()
    const payload = { ...values, user_id: userId }

    let error
    if (pm) {
      ;({ error } = await supabase.from("project_managers").update(payload).eq("id", pm.id))
    } else {
      ;({ error } = await supabase.from("project_managers").insert(payload))
    }

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return }

    toast({ title: pm ? "PM updated" : "PM added", description: values.name })
    form.reset()
    setOpen(false)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus className="w-4 h-4 mr-2" />Add Project Manager
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pm ? "Edit Project Manager" : "Add Project Manager"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl><Input placeholder="John Smith" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="grid grid-cols-2 gap-4">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone</FormLabel>
                  <FormControl><Input placeholder="(555) 000-0000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="pm@company.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem>
                <FormLabel>Color</FormLabel>
                <FormControl>
                  <div className="flex items-center gap-3">
                    {/* Native color picker */}
                    <div className="relative w-10 h-10 rounded-lg overflow-hidden border border-input shrink-0">
                      <div className="absolute inset-0 rounded-lg" style={{ backgroundColor: field.value }} />
                      <input
                        type="color"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                      />
                    </div>
                    {/* Quick presets */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {PM_COLOR_PRESETS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => field.onChange(color)}
                          className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
                          style={{
                            backgroundColor: color,
                            borderColor: field.value === color ? "white" : "transparent",
                            boxShadow: field.value === color ? `0 0 0 2px ${color}` : undefined,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {pm ? "Save Changes" : "Add PM"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

interface TogglePMButtonProps {
  pmId: string
  pmName: string
  isActive: boolean
}

export function TogglePMButton({ pmId, pmName, isActive }: TogglePMButtonProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleToggle() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("project_managers").update({ is_active: !isActive }).eq("id", pmId)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }) }
    else { toast({ title: isActive ? "PM deactivated" : "PM reactivated", description: pmName }) }
    setLoading(false)
    router.refresh()
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      className={isActive ? "text-muted-foreground hover:text-foreground" : "text-muted-foreground"}
      onClick={handleToggle}
      disabled={loading}
      title={isActive ? "Deactivate" : "Reactivate"}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? "Deactivate" : "Reactivate"}
    </Button>
  )
}

interface ArchivePMButtonProps {
  pmId: string
  pmName: string
  isArchived: boolean
}

export function ArchivePMButton({ pmId, pmName, isArchived }: ArchivePMButtonProps) {
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleArchive() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase
      .from("project_managers")
      .update({ is_archived: !isArchived })
      .eq("id", pmId)
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }) }
    else { toast({ title: isArchived ? "PM restored" : "PM archived", description: pmName }) }
    setLoading(false)
    router.refresh()
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleArchive} disabled={loading} title={isArchived ? "Restore" : "Archive"}>
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isArchived ? (
        <ArchiveRestore className="w-4 h-4" />
      ) : (
        <Archive className="w-4 h-4" />
      )}
    </Button>
  )
}

interface DeletePMButtonProps {
  pmId: string
  pmName: string
}

export function DeletePMButton({ pmId, pmName }: DeletePMButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  async function handleDelete() {
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.from("project_managers").delete().eq("id", pmId)
    setLoading(false)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "PM deleted", description: `"${pmName}" permanently deleted.` })
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
        title="Delete permanently"
      >
        <Trash2 className="w-4 h-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Permanently Delete PM?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">"{pmName}"</span> will be permanently
            removed. Their jobs will remain but become unassigned. This cannot be undone.
          </p>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
