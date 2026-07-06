"use client"

import { Clock, LayoutGrid, Settings } from "lucide-react"

export type PanelTab = "dialpad" | "recent" | "settings"

const TABS: { id: PanelTab; label: string; Icon: typeof Clock }[] = [
  { id: "dialpad", label: "Dialpad", Icon: LayoutGrid },
  { id: "recent", label: "Recent", Icon: Clock },
  { id: "settings", label: "Settings", Icon: Settings },
]

export function PanelTabs({
  active,
  onChange,
}: {
  active: PanelTab
  onChange: (t: PanelTab) => void
}) {
  return (
    <div className="flex border-b border-neutral-800">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-xs font-medium transition ${
            active === id
              ? "text-white"
              : "text-neutral-500 hover:text-neutral-300"
          }`}
          aria-current={active === id}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  )
}
