"use client"

import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export const PRESET_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#3b82f6", // blue
  "#8b5cf6", // violet
  "#f97316", // orange
  "#06b6d4", // cyan
]

/**
 * Returns the first preset color not already used, falling back to the first.
 */
export function firstAvailableColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((c) => c.toLowerCase()))
  return (
    PRESET_COLORS.find((c) => !used.has(c.toLowerCase())) ?? PRESET_COLORS[0]
  )
}

export function ColorPicker({
  value,
  onChange,
  usedColors,
}: {
  value: string
  onChange: (color: string) => void
  /** Colors already taken by other numbers — shows a soft warning. */
  usedColors: string[]
}) {
  const usedByOther = usedColors.some(
    (c) => c.toLowerCase() === value.toLowerCase()
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase()
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              aria-label={`Select color ${c}`}
              aria-pressed={active}
              className={cn(
                "flex h-8 w-8 cursor-pointer items-center justify-center rounded-md ring-offset-2 ring-offset-background transition-all",
                active && "ring-2 ring-foreground/40"
              )}
              style={{ backgroundColor: c }}
            >
              {active && <Check className="h-4 w-4 text-white" />}
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-border/60"
          style={{ backgroundColor: value }}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#6366f1"
          className="w-32 rounded-lg border border-border/60 bg-background/80 px-3 py-2 font-mono text-sm text-foreground transition-colors duration-200 focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
        />
      </div>

      {usedByOther && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          This color is already used by another number.
        </p>
      )}
    </div>
  )
}
