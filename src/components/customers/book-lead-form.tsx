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
import { AlertTriangle, CalendarDays, Check, Loader2, MapPin, Star, UserCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { DatePicker } from "@/components/ui/date-picker"
import { arrivalWindow } from "@/lib/arrival-window"

const JOB_TYPES = [
  "Artificial turf", "Pavers", "Concrete", "Gravel / DG / xeriscape", "Full backyard remodel",
  "Pool remodel / resurfacing", "Kitchen remodel", "Bathroom remodel", "Windows", "Roofing",
  "Insulation", "HVAC", "Gutters", "Plumbing", "Exterior painting", "Cool Life paint", "Mold removal",
]
const OTHER = "__other"

interface PmOption { id: string; name: string; color: string }
interface Nearby { name: string; city: string | null; time: string; miles: number }
interface Day { date: string; times: string[]; nearby?: Nearby[] }
interface DayCheck {
  appointments: { name: string; city: string | null; start: string; end: string; miles: number | null }[]
  problems:     { kind: "double" | "tight"; with: string; message: string }[]
}

function dayLabel(date: string) {
  const d = new Date(`${date}T12:00:00`)
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}
function timeLabel(t: string) {
  const [h, m] = t.split(":").map(Number)
  return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`
}

function NearbyBox({ day, nearby }: { day: string; nearby: Nearby[] }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1">
      <p className="text-sm font-medium flex items-center gap-1.5">
        <Star className="w-4 h-4 fill-amber-400 text-amber-500" />
        Already nearby on {dayLabel(day)}
      </p>
      {nearby.map((n, i) => (
        <p key={i} className="text-sm text-muted-foreground flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 shrink-0" />
          {timeLabel(n.time)}: {n.name}{n.city ? `, ${n.city}` : ""} ({n.miles <= 1 ? "same area" : `${n.miles} mi away`})
        </p>
      ))}
      <p className="text-xs text-muted-foreground">Pick a time right before or after these to keep David&apos;s driving short.</p>
    </div>
  )
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
  const [pickedDay, setDay] = useState<string | null>(null)
  const [pickedTime, setTime] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // "any": book any date and time, not just the booking system's open times.
  const [mode, setMode] = useState<"open" | "any">("open")
  const [anyDate, setAnyDate] = useState("")
  const [anyTime, setAnyTime] = useState("09:00")
  const [nearbyByDate, setNearbyByDate] = useState<Record<string, Nearby[]>>({})
  const day = mode === "any" ? (anyDate || null) : pickedDay
  const time = mode === "any" ? (/^\d{2}:\d{2}$/.test(anyTime) ? anyTime : null) : pickedTime
  const todayPt = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const anyInPast = mode === "any" && !!anyDate && anyDate < todayPt

  // The ZIP comes from the address when it has one; it can be typed too.
  useEffect(() => {
    const m = address.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)
    if (m) setZip(m[1])
  }, [address])

  useEffect(() => {
    if (zip.length !== 5) { setDays(null); return }
    let cancelled = false
    setLoadingTimes(true); setTimesError(null)
    fetch(`/api/leads/availability?zip=${zip}&brand=${brand}${pmId !== "none" ? `&pm_id=${pmId}` : ""}`)
      .then(async (r) => {
        const data = await r.json()
        if (cancelled) return
        if (!r.ok) { setTimesError(data.error ?? "Couldn't load times"); setDays(null); return }
        setOutOfArea(data.inArea === false)
        setDays(data.days)
        setNearbyByDate(data.nearbyByDate ?? {})
        setDay((d) => (d && data.days.some((x: Day) => x.date === d) ? d : data.days[0]?.date ?? null))
        setTime(null)
      })
      .catch(() => !cancelled && setTimesError("Couldn't load times"))
      .finally(() => !cancelled && setLoadingTimes(false))
    return () => { cancelled = true }
  }, [zip, brand, pmId])

  // That day's other estimates + double-booking / drive-time warnings.
  const [dayCheck, setDayCheck] = useState<DayCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const [bookAnyway, setBookAnyway] = useState(false)
  useEffect(() => {
    setBookAnyway(false)
    if (!day || !time) { setDayCheck(null); return }
    let cancelled = false
    setChecking(true)
    const t = setTimeout(() => {
      fetch(`/api/leads/day-check?date=${day}&time=${time}${zip.length === 5 ? `&zip=${zip}` : ""}${pmId !== "none" ? `&pm_id=${pmId}` : ""}`)
        .then(async (r) => { const d = await r.json(); if (!cancelled) setDayCheck(r.ok ? d : null) })
        .catch(() => !cancelled && setDayCheck(null))
        .finally(() => !cancelled && setChecking(false))
    }, 300)
    return () => { cancelled = true; clearTimeout(t) }
  }, [day, time, zip, pmId])
  const problems = dayCheck?.problems ?? []

  const jobType = jobChoice === OTHER ? jobCustom.trim() : jobChoice
  const dayTimes = useMemo(() => days?.find((d) => d.date === day)?.times ?? [], [days, day])
  const dayNearby = useMemo(() => (day ? nearbyByDate[day] ?? days?.find((d) => d.date === day)?.nearby ?? [] : []), [days, day, nearbyByDate])
  const starredDays = days?.filter((d) => d.nearby?.length).length ?? 0
  const ready = name.trim() && phone.replace(/\D/g, "").length >= 10 && address.trim().length >= 5 && jobType && day && time && !anyInPast && (problems.length === 0 || bookAnyway)

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
          {pms.length > 0 && (
            <Field label="Who goes to the estimate">
              <Select value={pmId} onValueChange={setPmId}>
                <SelectTrigger className="w-full sm:w-64">
                  <UserCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                  <SelectValue placeholder="David (default)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">David (default)</SelectItem>
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
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold">
              Estimate time *{pmId !== "none" && pms.find((p) => p.id === pmId) ? ` (${pms.find((p) => p.id === pmId)!.name.split(" ")[0]}'s open times)` : ""}
            </span>
            {loadingTimes && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          </div>
          <Toggle value={mode} onChange={setMode} options={[{ value: "open", label: "Open times" }, { value: "any", label: "Any day & time" }]} />
          {mode === "any" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Book any day and time, even if the booking system shows it as full or closed. It goes on the Google Calendar like any booking, so the website won't offer that time to anyone else.
              </p>
              <div className="flex flex-wrap gap-3">
                <Field label="Date" className="w-full sm:w-56">
                  <DatePicker value={anyDate} onChange={setAnyDate} />
                </Field>
                <Field label="Time" className="w-40">
                  <Input type="time" step={900} value={anyTime} onChange={(e) => setAnyTime(e.target.value)} />
                </Field>
              </div>
              {anyInPast && <p className="text-sm text-destructive">That date has already passed.</p>}
              {day && time && !anyInPast && (
                <p className="text-sm text-muted-foreground">
                  The customer is told: {dayLabel(day)}, {arrivalWindow(time)}.
                </p>
              )}
              {dayNearby.length > 0 && <NearbyBox day={day!} nearby={dayNearby} />}
            </div>
          )}
          {mode === "open" && <>
          {zip.length !== 5 && <p className="text-sm text-muted-foreground">Enter the address (or ZIP) to see open times.</p>}
          {timesError && <p className="text-sm text-destructive">{timesError}</p>}
          {outOfArea && <p className="text-sm text-amber-600">This ZIP is outside the website service area. You can still book it.</p>}
          {days && !days.length && <p className="text-sm text-muted-foreground">No open times in the next few weeks. Use &quot;Any day &amp; time&quot; to book anyway.</p>}
          {days && days.length > 0 && (
            <>
              {starredDays > 0 && (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-500 shrink-0" />
                  David already has an estimate near this address on starred days. Try to book one of those.
                </p>
              )}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((d) => {
                  const near = d.nearby?.length ?? 0
                  return (
                    <Button key={d.date} type="button" size="sm" variant={day === d.date ? "default" : "outline"}
                      className={cn("shrink-0 gap-1", near > 0 && day !== d.date && "border-amber-400 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40")}
                      title={near ? `${near} estimate${near > 1 ? "s" : ""} nearby: ${d.nearby!.map((n) => `${n.name} (${n.city ?? "?"}, ${n.miles} mi)`).join(", ")}` : undefined}
                      onClick={() => { setDay(d.date); setTime(null) }}>
                      {near > 0 && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-500" />}
                      {dayLabel(d.date)}
                      {near > 1 && <span className="text-xs font-semibold">×{near}</span>}
                    </Button>
                  )
                })}
              </div>
              {dayNearby.length > 0 && <NearbyBox day={day!} nearby={dayNearby} />}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                {dayTimes.map((t) => (
                  <Button key={t} type="button" size="sm" variant={time === t ? "default" : "outline"} onClick={() => setTime(t)}>
                    {timeLabel(t)}
                  </Button>
                ))}
              </div>
            </>
          )}
          </>}

          {day && time && (checking || dayCheck) && (
            <div className={cn("rounded-md border p-3 space-y-1.5",
              problems.length ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/40")}>
              {checking && !dayCheck ? (
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking David&apos;s day…</p>
              ) : dayCheck && (
                <>
                  {problems.map((p, i) => (
                    <p key={i} className="text-sm font-medium text-destructive flex items-start gap-1.5">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {p.message}
                    </p>
                  ))}
                  {problems.length === 0 && (
                    <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5">
                      <Check className="w-4 h-4" />
                      {dayCheck.appointments.length ? "No clash, and enough time to drive between estimates." : `Nothing else on ${dayLabel(day)}.`}
                    </p>
                  )}
                  {dayCheck.appointments.length > 0 && (
                    <div className="pt-1 space-y-0.5">
                      <p className="text-xs font-medium text-muted-foreground">David&apos;s estimates on {dayLabel(day)}:</p>
                      {dayCheck.appointments.map((a, i) => (
                        <p key={i} className="text-xs text-muted-foreground">
                          {timeLabel(a.start)}–{timeLabel(a.end)} · {a.name}{a.city ? `, ${a.city}` : ""}{a.miles != null ? ` (${a.miles <= 1 ? "same area" : `${a.miles} mi away`})` : ""}
                        </p>
                      ))}
                      {zip.length !== 5 && <p className="text-xs text-muted-foreground">Add the ZIP to check drive times.</p>}
                    </div>
                  )}
                  {problems.length > 0 && (
                    <label className="flex items-center gap-2 text-sm pt-1">
                      <input type="checkbox" checked={bookAnyway} onChange={(e) => setBookAnyway(e.target.checked)} />
                      I know. Book it anyway.
                    </label>
                  )}
                </>
              )}
            </div>
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
