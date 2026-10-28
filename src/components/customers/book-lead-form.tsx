"use client"

// "Add lead" in the CRM: the same questions as the website booking form, the
// real open estimate times, and a PM. Booking puts it on Google Calendar and
// texts the customer a confirmation from their company's number.

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { AddressAutocomplete } from "@/components/ui/address-autocomplete"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CalendarDays, Loader2, UserCircle } from "lucide-react"
import { cn } from "@/lib/utils"

const JOB_TYPES = [
  "Artificial turf", "Pavers", "Concrete", "Gravel / DG / xeriscape", "Full backyard remodel",
  "Pool remodel / resurfacing", "Kitchen remodel", "Bathroom remodel", "Windows", "Roofing",
  "Insulation", "HVAC", "Gutters", "Plumbing", "Exterior painting", "Cool Life paint",
]
const OTHER = "__other"

interface PmOption { id: string; name: string; color: string }
interface Day { date: string; times: string[] }

function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-sm font-medium mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2">
      {options.map((o) => (
        <Button key={o.value} type="button" size="sm" variant={value === o.value ? "default" : "outline"} onClick={() => onChange(o.value)}>
          {o.label}
        </Button>
      ))}
    </div>
  )
}

export function BookLeadForm({ pms }: { pms: PmOption[] }) {
  const router = useRouter()
  const { toast } = useToast()

  const [brand, setBrand] = useState<"omdan" | "desert_green">("omdan")
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [email, setEmail] = useState("")
  const [address, setAddress] = useState("")
  const [zip, setZip] = useState("")
  const [homeowner, setHomeowner] = useState<"yes" | "no">("yes")
  const [jobChoice, setJobChoice] = useState("")
  const [jobCustom, setJobCustom] = useState("")
  const [description, setDescription] = useState("")
  const [language, setLanguage] = useState<"en" | "es">("en")
  const [pmId, setPmId] = useState("none")
  const [sendText, setSendText] = useState(true)

  const [days, setDays] = useState<Day[] | null>(null)
  const [loadingTimes, setLoadingTimes] = useState(false)
  const [timesError, setTimesError] = useState<string | null>(null)
  const [outOfArea, setOutOfArea] = useState(false)
  const [day, setDay] = useState<string | null>(null)
  const [time, setTime] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The ZIP comes from the address when it has one; it can be typed too.
  useEffect(() => {
    const m = address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)
    if (m) setZip(m[1])
  }, [address])

  useEffect(() => {
    if (zip.length !== 5) { setDays(null); return }
    let cancelled = false
    setLoadingTimes(true); setTimesError(null)
    fetch(`/api/leads/availability?zip=${zip}&brand=${brand}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (!r.ok) { setTimesError(data.error ?? "Couldn't load times"); setDays(null); return }
        setOutOfArea(data.inArea === false)
        setDays(data.days)
        setDay((d) => (d && data.days.some((x: Day) => x.date === d) ? d : data.days[0]?.date ?? null))
        setTime(null)
      })
      .catch(() => !cancelled && setTimesError("Couldn't load times"))
      .finally(() => !cancelled && setLoadingTimes(false))
    return () => { cancelled = true }
  }, [zip, brand])

  const jobType = jobChoice === OTHER ? jobCustom.trim() : jobChoice
  const dayTimes = useMemo(() => days?.find((d) => d.date === day)?.times ?? [], [days, day])
  const ready = name.trim() && phone.replace(/\D/g, "").length >= 10 && address.trim().length >= 5 && jobType && day && time

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || saving) return
    setSaving(true)
    try {
      const res = await fetch("/api/leads/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brand, full_name: name, phone, email: email || null, address, homeowner, job_type: jobType,
          description, language, date: day, time, pm_id: pmId === "none" ? null : pmId, send_text: sendText,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast({ title: "Couldn't book", description: data.error, variant: "destructive" }); return }
      const problems = [data.calendar !== "added" && `Calendar ${data.calendar}`, sendText && data.text !== "sent" && `Text ${data.text}`].filter(Boolean)
      toast({
        title: `Booked: ${name}, ${dayLabel(day!)} at ${timeLabel(time!)}`,
        description: problems.length ? problems.join(" · ") : `On Google Calendar${sendText ? " and confirmation text sent" : ""}.`,
        variant: problems.length ? "destructive" : undefined,
      })
      router.push(`/customers/${data.customer_id}`)
      router.refresh()
    } catch {
      toast({ title: "Network error", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card>
        <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company" className="sm:col-span-2">
            <Toggle value={brand} onChange={setBrand} options={[{ value: "omdan", label: "Omdan Development" }, { value: "desert_green", label: "Desert Green Builders" }]} />
          </Field>
          <Field label="Full name *" className="sm:col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Smith" />
          </Field>
          <Field label="Phone *">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(760) 555-1234" inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="optional" type="email" />
          </Field>
          <Field label="Address *" className="sm:col-span-2">
            <AddressAutocomplete value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Palm Desert, CA 92260" />
          </Field>
          <Field label="ZIP">
            <Input value={zip} onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))} placeholder="92260" inputMode="numeric" />
          </Field>
          <Field label="Are they the homeowner?">
            <Toggle value={homeowner} onChange={setHomeowner} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} />
          </Field>
          <Field label="Type of job *">
            <Select value={jobChoice} onValueChange={setJobChoice}>
              <SelectTrigger><SelectValue placeholder="Pick a job type" /></SelectTrigger>
              <SelectContent>
                {JOB_TYPES.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
                <SelectItem value={OTHER}>Other (type it)</SelectItem>
              </SelectContent>
            </Select>
            {jobChoice === OTHER && (
              <Input className="mt-2" value={jobCustom} onChange={(e) => setJobCustom(e.target.value)} placeholder="e.g. Block wall and gate" autoFocus />
            )}
          </Field>
          <Field label="Language">
            <Toggle value={language} onChange={setLanguage} options={[{ value: "en", label: "English" }, { value: "es", label: "Spanish" }]} />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[100px]"
              placeholder="What they want done, size, timeline, gate code, anything David should know..." />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">Estimate time *</span>
            {loadingTimes && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          {zip.length !== 5 && <p className="text-sm text-muted-foreground">Enter the address (or ZIP) to see open times.</p>}
          {timesError && <p className="text-sm text-destructive">{timesError}</p>}
          {outOfArea && <p className="text-sm text-amber-600">This ZIP is outside the website service area. You can still book it.</p>}
          {days && !days.length && <p className="text-sm text-muted-foreground">No open times in the next few weeks.</p>}
          {days && days.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => (
                  <Button key={d.date} type="button" size="sm" variant={day === d.date ? "default" : "outline"} className="shrink-0"
                    onClick={() => { setDay(d.date); setTime(null) }}>
                    {dayLabel(d.date)}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {dayTimes.map((t) => (
                  <Button key={t} type="button" size="sm" variant={time === t ? "default" : "outline"} onClick={() => setTime(t)}>
                    {timeLabel(t)}
                  </Button>
                ))}
              </div>
            </>
          )}

          {pms.length > 0 && (
            <Field label="Assign PM">
              <Select value={pmId} onValueChange={setPmId}>
                <SelectTrigger className="w-full sm:w-64">
                  <UserCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="No PM assigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No PM assigned</SelectItem>
                  {pms.map((pm) => (
                    <SelectItem key={pm.id} value={pm.id}>
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: pm.color }} />
                        {pm.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sendText} onChange={(e) => setSendText(e.target.checked)} />
            Text the customer a confirmation from {brand === "omdan" ? "(951) 292-0703" : "(760) 548-2781"}
          </label>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3 flex-wrap">
        <Button type="submit" disabled={!ready || saving}>
          {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Book estimate
        </Button>
        <Link href="/customers/new?plain=1" className={cn("text-sm text-muted-foreground underline")}>
          Add a lead without an appointment
        </Link>
      </div>
    </form>
  )
}
