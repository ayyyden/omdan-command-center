import * as React from "react"
import { cn } from "@/lib/utils"

export interface NumericInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  allowDecimals?: boolean
}

const NumericInput = React.forwardRef<HTMLInputElement, NumericInputProps>(
  ({ className, allowDecimals = true, onFocus, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type="number"
        step={allowDecimals ? "any" : "1"}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
          "ring-offset-background placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Remove browser spinner arrows
          "[appearance:textfield]",
          "[&::-webkit-inner-spin-button]:appearance-none",
          "[&::-webkit-outer-spin-button]:appearance-none",
          className
        )}
        onFocus={(e) => {
          e.target.select()
          onFocus?.(e)
        }}
        {...props}
      />
    )
  }
)
NumericInput.displayName = "NumericInput"

export { NumericInput }
