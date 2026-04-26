"use client"

import { useState, useEffect, useRef, forwardRef } from "react"
import { MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Maps script loader ────────────────────────────────────────────────────────

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""

let mapsPromise: Promise<void> | null = null

function loadMaps(): Promise<void> {
  if (!API_KEY) return Promise.reject()
  if (mapsPromise) return mapsPromise

  mapsPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined") { reject(); return }
    if ((window as any).google?.maps?.places) { resolve(); return }

    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=places`
    script.async = true
    script.defer = true
    script.onload  = () => resolve()
    script.onerror = () => { mapsPromise = null; reject() }
    document.head.appendChild(script)
  })

  return mapsPromise
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Prediction {
  placeId: string
  main: string
  secondary: string
  full: string
}

export interface AddressAutocompleteProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value?: string
  onChange?: React.ChangeEventHandler<HTMLInputElement>
}

// ── Component ─────────────────────────────────────────────────────────────────

export const AddressAutocomplete = forwardRef<HTMLInputElement, AddressAutocompleteProps>(
  ({ value = "", onChange, onBlur, className, ...rest }, ref) => {
    const [predictions, setPredictions] = useState<Prediction[]>([])
    const [open, setOpen]               = useState(false)
    const [ready, setReady]             = useState(false)
    const [activeIdx, setActiveIdx]     = useState(-1)

    const wrapperRef      = useRef<HTMLDivElement>(null)
    const autoSvcRef      = useRef<any>(null)   // AutocompleteService
    const placesSvcRef    = useRef<any>(null)   // PlacesService (for getDetails)
    const placesDivRef    = useRef<HTMLDivElement | null>(null)
    const debounceRef     = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Prevents the debounce effect from re-querying after the user selects a suggestion.
    // Set to true before fireChange(); the effect resets it to false and skips the query.
    const justSelected    = useRef(false)

    // Load Maps once
    useEffect(() => {
      if (!API_KEY) return
      loadMaps()
        .then(() => setReady(true))
        .catch(() => {})
    }, [])

    // Close on outside click / tap
    useEffect(() => {
      function handle(e: MouseEvent | TouchEvent) {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
          setOpen(false)
        }
      }
      document.addEventListener("mousedown", handle)
      document.addEventListener("touchstart", handle, { passive: true })
      return () => {
        document.removeEventListener("mousedown", handle)
        document.removeEventListener("touchstart", handle)
      }
    }, [])

    // Debounced autocomplete query
    useEffect(() => {
      // Skip if this change was caused by selecting a suggestion
      if (justSelected.current) {
        justSelected.current = false
        return
      }

      if (!ready || !value || value.length < 3) {
        setPredictions([])
        setOpen(false)
        return
      }

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const g = (window as any).google
        if (!g?.maps?.places) return

        if (!autoSvcRef.current) {
          autoSvcRef.current = new g.maps.places.AutocompleteService()
        }

        autoSvcRef.current.getPlacePredictions(
          { input: value, componentRestrictions: { country: "us" }, types: ["address"] },
          (results: any[] | null, status: string) => {
            if (status !== "OK" || !results?.length) {
              setPredictions([])
              setOpen(false)
              return
            }
            setPredictions(
              results.map((r) => ({
                placeId:   r.place_id,
                main:      r.structured_formatting.main_text,
                secondary: r.structured_formatting.secondary_text,
                full:      r.description.replace(/, USA$/, ""),
              }))
            )
            setOpen(true)
            setActiveIdx(-1)
          }
        )
      }, 300)

      return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
    }, [value, ready])

    // Synthesise a change event compatible with RHF Controller
    function fireChange(val: string) {
      if (!onChange) return
      const event = {
        target:        { value: val },
        currentTarget: { value: val },
      } as React.ChangeEvent<HTMLInputElement>
      onChange(event)
    }

    function closeDropdown() {
      setPredictions([])
      setOpen(false)
      setActiveIdx(-1)
    }

    function getPlacesService(): any {
      const g = (window as any).google
      if (!g?.maps?.places) return null
      if (!placesSvcRef.current) {
        if (!placesDivRef.current) placesDivRef.current = document.createElement("div")
        placesSvcRef.current = new g.maps.places.PlacesService(placesDivRef.current)
      }
      return placesSvcRef.current
    }

    function select(prediction: Prediction) {
      // Cancel any pending debounce immediately
      if (debounceRef.current) clearTimeout(debounceRef.current)

      // Close the dropdown right away — before any async work
      closeDropdown()

      // Guard the next two value-change re-renders from triggering a new query:
      // one for the fallback value, one for the resolved address with ZIP.
      justSelected.current = true
      fireChange(prediction.full)

      // Fetch full details (formatted_address includes ZIP)
      const svc = getPlacesService()
      if (!svc) return

      svc.getDetails(
        { placeId: prediction.placeId, fields: ["formatted_address"] },
        (place: any, status: string) => {
          if (status === "OK" && place?.formatted_address) {
            const address = place.formatted_address.replace(/, USA$/, "")
            // Guard this second value change too
            justSelected.current = true
            fireChange(address)
          }
          // On failure, the fallback (prediction.full) is already set — nothing to do
        }
      )
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
      if (!open || !predictions.length) return
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, predictions.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, -1))
      } else if (e.key === "Enter" && activeIdx >= 0) {
        e.preventDefault()
        select(predictions[activeIdx])
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    }

    const inputClass = cn(
      "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
      "ring-offset-background placeholder:text-muted-foreground",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )

    return (
      <div ref={wrapperRef} className="relative">
        <input
          ref={ref}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          className={inputClass}
          {...rest}
        />

        {open && predictions.length > 0 && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border border-border bg-popover shadow-lg overflow-hidden max-h-56 overflow-y-auto"
          >
            {predictions.map((p, i) => (
              <li
                key={p.placeId}
                role="option"
                aria-selected={i === activeIdx}
                // onMouseDown + preventDefault keeps focus on input; onTouchEnd for iOS
                onMouseDown={(e) => { e.preventDefault(); select(p) }}
                onTouchEnd={(e)  => { e.preventDefault(); select(p) }}
                className={cn(
                  "flex items-start gap-3 px-3 py-3 cursor-pointer select-none transition-colors min-h-[44px]",
                  i === activeIdx ? "bg-accent" : "hover:bg-accent/60 active:bg-accent"
                )}
              >
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">{p.main}</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">{p.secondary}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }
)

AddressAutocomplete.displayName = "AddressAutocomplete"
