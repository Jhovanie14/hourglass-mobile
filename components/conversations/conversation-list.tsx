"use client"

import { useMemo, useState } from "react"
import { formatDistanceToNow } from "date-fns"
import { MessageSquare, Search, SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { ALL_INBOXES } from "./inbox-switcher"
import type { Conversation, PhoneNumber } from "@/types/conversations"

function truncate(text: string | null, max = 45) {
  if (!text) return "No messages yet"
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function ConversationList({
  conversations,
  phoneNumbers,
  selectedInbox,
  selectedConversationId,
  onSelectConversation,
  onCompose,
  loading,
}: {
  conversations: Conversation[]
  phoneNumbers: PhoneNumber[]
  selectedInbox: string
  selectedConversationId: string | null
  onSelectConversation: (c: Conversation) => void
  onCompose: () => void
  loading?: boolean
}) {
  const [query, setQuery] = useState("")

  const inboxName =
    selectedInbox === ALL_INBOXES
      ? "All Inboxes"
      : (phoneNumbers.find((p) => p.id === selectedInbox)?.label ?? "Inbox")

  const colorById = useMemo(() => {
    const map: Record<string, string> = {}
    for (const p of phoneNumbers) map[p.id] = p.color
    return map
  }, [phoneNumbers])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return conversations.filter((c) => {
      if (selectedInbox !== ALL_INBOXES && c.phone_number_id !== selectedInbox)
        return false
      if (!q) return true
      return (
        c.contact_number.toLowerCase().includes(q) ||
        (c.last_message_text ?? "").toLowerCase().includes(q)
      )
    })
  }, [conversations, query, selectedInbox])

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-r border-border bg-card sm:w-[300px] sm:shrink-0">
      {/* Header */}
      <div className="space-y-3 border-b border-border p-3">
        <div className="flex items-center justify-between">
          <h2 className="truncate text-base font-semibold text-foreground">
            {inboxName}
          </h2>
          <Button size="sm" onClick={onCompose} className="cursor-pointer gap-1.5">
            <SquarePen className="h-4 w-4" />
            New
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <label htmlFor="conv-search" className="sr-only">
            Search conversations
          </label>
          <input
            id="conv-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg border border-border/60 bg-background/80 py-2 pr-3 pl-9 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
          />
        </div>
      </div>

      {/* List */}
      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-2">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2 py-1">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-1 px-4 py-16 text-center">
            <MessageSquare className="mb-1 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">
              No conversations yet
            </p>
            <p className="text-xs text-muted-foreground">
              Messages from your customers will appear here
            </p>
          </div>
        ) : (
          <ul>
            {filtered.map((c) => {
              const selected = c.id === selectedConversationId
              const showBadge = selectedInbox === ALL_INBOXES && c.phone_numbers
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelectConversation(c)}
                    className={cn(
                      "flex w-full items-start gap-3 border-b border-border/50 px-3 py-3 text-left transition-colors duration-200",
                      selected ? "bg-secondary" : "hover:bg-muted/40"
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium text-foreground">
                          {c.contact_number}
                        </span>
                        {showBadge && (
                          <span
                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
                            style={{
                              backgroundColor:
                                c.phone_numbers?.color ??
                                colorById[c.phone_number_id],
                            }}
                          >
                            {c.phone_numbers?.label}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {truncate(c.last_message_text)}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {c.last_message_at && (
                        <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                          {formatDistanceToNow(new Date(c.last_message_at), {
                            addSuffix: true,
                          })}
                        </span>
                      )}
                      {c.unread_count > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                          {c.unread_count}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}
