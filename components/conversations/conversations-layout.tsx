"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/client"
import { cn } from "@/lib/utils"
import { useConversations } from "./use-conversations"
import { InboxSwitcher, ALL_INBOXES } from "./inbox-switcher"
import { ConversationList } from "./conversation-list"
import { ChatView } from "./chat-view"
import { ComposeModal } from "./compose-modal"
import type { Conversation, PhoneNumber } from "@/types/conversations"

export function ConversationsLayout({
  phoneNumbers,
  initialConversations,
  prefillContact,
  prefillInbox,
}: {
  phoneNumbers: PhoneNumber[]
  initialConversations: Conversation[]
  prefillContact?: string
  prefillInbox?: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()

  // Data orchestration — list, both Realtime channels, mark-read, send,
  // compose, deletes — is shared with the extension panel's Messages tab.
  const {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    unreadByInbox,
    selectConversation,
    clearSelection,
    send,
    deleteMessage,
    deleteConversation,
    markMessageQueued,
    refresh,
  } = useConversations({ supabase, phoneNumbers, initialConversations })

  // Inbox selection stays here on purpose: it writes to the URL, which is
  // meaningless inside the panel's iframe.
  const [selectedInbox, setSelectedInbox] = useState<string>(prefillInbox ?? ALL_INBOXES)

  const switchInbox = useCallback((id: string) => {
    setSelectedInbox(id)
    const params = new URLSearchParams()
    if (id !== ALL_INBOXES) params.set("inbox", id)
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`)
  }, [router, pathname])

  // Open the compose modal automatically when arriving with a prefilled contact
  // (e.g. "Send SMS" from the Calls page).
  const [composeOpen, setComposeOpen] = useState(Boolean(prefillContact))


  return (
    <div className="flex h-[calc(100svh-3.5rem)] overflow-hidden">
      {/* Column 1 — inbox switcher (hidden on mobile when a chat is open) */}
      <div className={cn(selected && "hidden sm:flex")}>
        <InboxSwitcher
          phoneNumbers={phoneNumbers}
          selected={selectedInbox}
          onSelect={switchInbox}
          unreadByInbox={unreadByInbox}
        />
      </div>

      {/* Column 2 — conversation list (hidden on mobile when a chat is open) */}
      <div className={cn("flex min-h-0 min-w-0", selected ? "hidden sm:flex" : "flex-1 sm:flex-none")}>
        <ConversationList
          conversations={conversations}
          phoneNumbers={phoneNumbers}
          selectedInbox={selectedInbox}
          selectedConversationId={selected?.id ?? null}
          onSelectConversation={selectConversation}
          onCompose={() => setComposeOpen(true)}
        />
      </div>

      {/* Column 3 — chat view */}
      {/* min-h-0 matters: without it this column refuses to shrink below its
          content, so a long thread grows the flex row and squeezes column 2. */}
      <div
        className={cn(
          "min-h-0 min-w-0 flex-1",
          selected ? "flex" : "hidden sm:flex"
        )}
      >
        <div className="flex h-full min-h-0 w-full flex-col">
          {/* Mobile back bar */}
          {selected && (
            <button
              type="button"
              onClick={clearSelection}
              className="flex cursor-pointer items-center gap-1.5 border-b border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
          <ChatView
            conversation={selected}
            phoneNumber={
              selected
                ? (phoneNumbers.find((p) => p.id === selected.phone_number_id) ??
                  null)
                : null
            }
            messages={messages}
            loading={loadingMessages}
            sending={sending}
            onSend={send}
            onDeleteMessage={deleteMessage}
            onResendMessage={(msg) => markMessageQueued(msg.id)}
            onDeleteConversation={() => selected && deleteConversation(selected.id)}
          />
        </div>
      </div>

      <ComposeModal
        open={composeOpen}
        onOpenChange={setComposeOpen}
        phoneNumbers={phoneNumbers}
        prefillContact={prefillContact}
        prefillInbox={prefillInbox}
        onSent={async (conversationId) => {
          // Find or refetch the conversation, then open it. refresh() returns
          // the fresh rows because reading `conversations` here would see the
          // pre-refresh state — a brand new thread would never be found.
          const existing = conversations.find((c) => c.id === conversationId)
          if (existing) {
            selectConversation(existing)
            return
          }
          const rows = await refresh()
          const created = rows.find((c) => c.id === conversationId)
          if (created) selectConversation(created)
        }}
      />
    </div>
  )
}
