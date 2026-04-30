"use client"

import * as React from "react"
import { DayPicker } from "react-day-picker"
import { cn } from "@/lib/utils"
import { ChevronLeft, ChevronRight } from "lucide-react"

export type CalendarProps = React.ComponentProps<typeof DayPicker>

export function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months:          "flex flex-col",
        month:           "space-y-3",
        month_caption:   "relative flex h-7 items-center justify-center",
        caption_label:   "text-sm font-medium",
        nav:             "absolute inset-x-0 flex items-center justify-between",
        button_previous: "inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50",
        button_next:     "inline-flex h-7 w-7 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50",
        month_grid:      "w-full border-collapse",
        weekdays:        "flex",
        weekday:         "w-9 text-center text-[0.75rem] font-medium text-muted-foreground",
        week:            "flex w-full mt-1",
        day:             "relative p-0 text-center",
        day_button:      "h-9 w-9 inline-flex items-center justify-center rounded-md text-sm font-normal text-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring transition-colors aria-selected:bg-primary aria-selected:text-primary-foreground aria-selected:hover:bg-primary aria-selected:hover:text-primary-foreground disabled:pointer-events-none disabled:opacity-50",
        selected:        "",
        today:           "[&>button:not([aria-selected='true'])]:bg-accent [&>button:not([aria-selected='true'])]:text-accent-foreground [&>button:not([aria-selected='true'])]:font-semibold",
        outside:         "[&>button]:text-muted-foreground [&>button]:opacity-40",
        disabled:        "[&>button]:opacity-30 [&>button]:cursor-not-allowed",
        hidden:          "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left"
            ? <ChevronLeft className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />,
      }}
      {...props}
    />
  )
}
