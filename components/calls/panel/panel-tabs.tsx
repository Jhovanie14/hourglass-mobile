"use client"

import { Clock, LayoutGrid, MessageSquare, Settings } from "lucide-react"

export type PanelTab = "dialpad" | "recent" | "messages" | "settings"

const TABS: { id: PanelTab; label: string; Icon: typeof Clock }[] = [
  { id: "dialpad", label: "Dialpad", Icon: LayoutGrid },
  { id: "recent", label: "Recent", Icon: Clock },
  { id: "messages", label: "Messages", Icon: MessageSquare },
  { id: "settings", label: "Settings", Icon: Settings },
]

export function PanelTabs({
  active,
  onChange,
  badges,
}: {
  active: PanelTab
  onChange: (t: PanelTab) => void
  /** Unread counts per tab; only non-zero entries render a badge. */
  badges?: Partial<Record<PanelTab, number>>
}) {
  return (
    <div className="flex border-b border-neutral-800">
      {TABS.map(({ id, label, Icon }) => {
        const count = badges?.[id] ?? 0
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${
              active === id
                ? "text-white"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
            aria-current={active === id}
          >
            <span className="relative">
              <Icon className="h-4 w-4" />
              {count > 0 && (
                <span
                  className="absolute -right-2 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white"
                  aria-label={`${count} unread`}
                >
                  {count > 9 ? "9+" : count}
                </span>
              )}
            </span>
            {label}
          </button>
        )
      })}
    </div>
  )
}
