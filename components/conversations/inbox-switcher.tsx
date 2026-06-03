"use client"

import { Inbox } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { PhoneNumber } from "@/types/conversations"

export const ALL_INBOXES = "all"

export function InboxSwitcher({
  phoneNumbers,
  selected,
  onSelect,
  unreadByInbox,
}: {
  phoneNumbers: PhoneNumber[]
  selected: string
  onSelect: (id: string) => void
  /** Map of phone_number_id -> whether it has any unread conversations. */
  unreadByInbox: Record<string, boolean>
}) {
  return (
    <div className="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-border bg-card py-3">
      {/* All inboxes */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onSelect(ALL_INBOXES)}
            aria-label="All inboxes"
            aria-pressed={selected === ALL_INBOXES}
            className={cn(
              "flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl transition-colors duration-200",
              selected === ALL_INBOXES
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            <Inbox className="h-5 w-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">All inboxes</TooltipContent>
      </Tooltip>

      <div className="my-1 h-px w-8 bg-border" />

      {phoneNumbers.map((pn) => {
        const active = selected === pn.id
        const hasUnread = unreadByInbox[pn.id]
        return (
          <Tooltip key={pn.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onSelect(pn.id)}
                aria-label={pn.label}
                aria-pressed={active}
                className={cn(
                  "relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl text-sm font-semibold transition-colors duration-200",
                  active ? "text-white" : "text-muted-foreground hover:text-foreground"
                )}
                style={{
                  backgroundColor: active ? pn.color : undefined,
                }}
              >
                {!active && (
                  <span
                    className="absolute inset-0 rounded-xl opacity-15"
                    style={{ backgroundColor: pn.color }}
                  />
                )}
                <span className="relative">{pn.label.charAt(0).toUpperCase()}</span>
                {hasUnread && (
                  <span
                    className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card bg-destructive"
                    aria-label="Has unread messages"
                  />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{pn.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
