"use client"

import { useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { PhoneNumber as CallsPhoneNumber } from "@/types/calls"
import type { Conversation, PhoneNumber } from "@/types/conversations"
import { useConversations } from "@/components/conversations/use-conversations"
import { ConversationRows, ALL_LINES } from "./messages/conversation-rows"
import { ThreadView } from "./messages/thread-view"
import { ComposeView } from "./messages/compose-view"

type View = "list" | "thread" | "compose"

export function MessagesTab({
  supabase,
  phoneNumbers,
  accessToken,
  onUnreadChange,
}: {
  supabase: SupabaseClient
  /** The panel is fed types/calls.PhoneNumber, which omits is_active. */
  phoneNumbers: CallsPhoneNumber[]
  accessToken: string | undefined
  onUnreadChange: (count: number) => void
}) {
  // /api/calls/phone-numbers only ever returns active lines, so is_active is
  // true by construction. Adapting here keeps the mismatch in one place rather
  // than widening the shared conversations types.
  const lines = useMemo<PhoneNumber[]>(
    () => phoneNumbers.map((p) => ({ ...p, is_active: true })),
    [phoneNumbers]
  )

  const {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    totalUnread,
    selectConversation,
    clearSelection,
    send,
    startConversation,
    deleteMessage,
    deleteConversation,
    refresh,
  } = useConversations({
    supabase,
    phoneNumbers: lines,
    initialConversations: [],
    accessToken,
  })

  const [view, setView] = useState<View>("list")
  const [line, setLine] = useState(ALL_LINES)

  // The dashboard is handed a server-rendered list; the panel has none, so it
  // must fetch its own on mount or the list stays empty until a focus event.
  useEffect(() => {
    refresh()
  }, [refresh])

  // Lift the badge count to the tab bar.
  useEffect(() => {
    onUnreadChange(totalUnread)
  }, [totalUnread, onUnreadChange])

  async function open(c: Conversation) {
    await selectConversation(c)
    setView("thread")
  }

  function back() {
    clearSelection()
    setView("list")
  }

  async function compose(input: {
    phoneNumberId: string
    contactNumber: string
    body: string
  }) {
    const conversationId = await startConversation({
      phoneNumberId: input.phoneNumberId,
      contactNumber: input.contactNumber,
    })
    if (!conversationId) return

    // `conversations` in this closure is from the render before
    // startConversation's refresh landed, so the new row may not be in it yet.
    // Build the minimum viable row rather than depending on that timing.
    const created: Conversation =
      conversations.find((c) => c.id === conversationId) ?? {
        id: conversationId,
        phone_number_id: input.phoneNumberId,
        contact_number: input.contactNumber,
        last_message_at: null,
        last_message_text: null,
        unread_count: 0,
        created_at: new Date().toISOString(),
      }

    await selectConversation(created)
    setView("thread")
    // Pass `created` explicitly — selectConversation's state has not committed
    // yet, so send() would otherwise see a stale null selection and no-op.
    await send(input.body, created)
  }

  if (view === "compose") {
    return (
      <ComposeView
        phoneNumbers={lines}
        onBack={() => setView("list")}
        onSubmit={compose}
      />
    )
  }

  if (view === "thread" && selected) {
    return (
      <ThreadView
        conversation={selected}
        messages={messages}
        loading={loadingMessages}
        sending={sending}
        onBack={back}
        onSend={send}
        onDeleteMessage={deleteMessage}
        onDeleteConversation={async () => {
          await deleteConversation(selected.id)
          setView("list")
        }}
      />
    )
  }

  return (
    <ConversationRows
      conversations={conversations}
      phoneNumbers={lines}
      selectedLine={line}
      onSelectLine={setLine}
      onOpen={open}
      onCompose={() => setView("compose")}
    />
  )
}
