"use client"

import { useTheme } from "next-themes"
import { useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const

/**
 * Segmented Light / Dark / System control. Used on the settings page.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // Avoid hydration mismatch — theme is only known on the client.
  useEffect(() => setMounted(true), [])

  return (
    <div className="inline-flex rounded-lg border border-border/60 bg-background/80 p-1">
      {OPTIONS.map((opt) => {
        const active = mounted && theme === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => setTheme(opt.value)}
            className={
              "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
              (active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground")
            }
          >
            <opt.icon className="h-4 w-4" />
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
