"use client"

import { Plus } from "lucide-react"
import type { Conversation, PhoneNumber } from "@/types/conversations"
import { formatConversationRow } from "./conversation-row"

export const ALL_LINES = "all"

export function ConversationRows({
  conversations,
  phoneNumbers,
  selectedLine,
  onSelectLine,
  onOpen,
  onCompose,
}: {
  conversations: Conversation[]
  phoneNumbers: PhoneNumber[]
  selectedLine: string
  onSelectLine: (id: string) => void
  onOpen: (c: Conversation) => void
  onCompose: () => void
}) {
  const visible =
    selectedLine === ALL_LINES
      ? conversations
      : conversations.filter((c) => c.phone_number_id === selectedLine)

  return (
    <div className="flex h-full flex-col">
      {/* Filter and compose share one row — a separate switcher row would cost
          height the thread cannot spare at 340x360. */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-2 py-1.5">
        <select
          value={selectedLine}
          onChange={(e) => onSelectLine(e.target.value)}
          className="min-w-0 flex-1 truncate rounded bg-neutral-900 px-1.5 py-1 text-xs text-neutral-300 outline-none"
          aria-label="Filter by line"
        >
          <option value={ALL_LINES}>All lines</option>
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onCompose}
          className="shrink-0 rounded p-1 text-neutral-400 transition hover:bg-neutral-800 hover:text-white"
          aria-label="New message"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="p-4 text-center text-xs text-neutral-500">
            No conversations yet.
          </p>
        ) : (
          visible.map((c) => {
            const v = formatConversationRow(c)
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c)}
                className="flex w-full items-start gap-2 border-b border-neutral-900 px-2 py-2 text-left transition hover:bg-neutral-900"
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                    v.unread ? "bg-red-500" : "bg-transparent"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    {v.lineColor && (
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: v.lineColor }}
                      />
                    )}
                    <span
                      className={`truncate text-xs ${
                        v.unread ? "font-semibold text-white" : "text-neutral-300"
                      }`}
                    >
                      {v.title}
                    </span>
                  </span>
                  <span className="block truncate text-[11px] text-neutral-500">
                    {v.preview}
                  </span>
                </span>
                <span className="shrink-0 text-[10px] text-neutral-600">
                  {v.timeText}
                </span>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
