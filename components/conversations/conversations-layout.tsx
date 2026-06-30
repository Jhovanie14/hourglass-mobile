"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/client"
import { cn } from "@/lib/utils"
import {
  deleteConversation,
  sendMessage,
} from "@/app/dashboard/conversations/actions"
import { toast } from "sonner"
import { InboxSwitcher, ALL_INBOXES } from "./inbox-switcher"
import { ConversationList } from "./conversation-list"
import { ChatView } from "./chat-view"
import { ComposeModal } from "./compose-modal"
import type {
  Conversation,
  Message,
  PhoneNumber,
} from "@/types/conversations"

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

  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations)
  const [selectedInbox, setSelectedInbox] = useState<string>(prefillInbox ?? ALL_INBOXES)

  const switchInbox = useCallback((id: string) => {
    setSelectedInbox(id)
    const params = new URLSearchParams()
    if (id !== ALL_INBOXES) params.set("inbox", id)
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`)
  }, [router, pathname])
  
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)
  // Open the compose modal automatically when arriving with a prefilled contact
  // (e.g. "Send SMS" from the Calls page).
  const [composeOpen, setComposeOpen] = useState(Boolean(prefillContact))


  const phoneById = useMemo(() => {
    const map: Record<string, PhoneNumber> = {}
    for (const p of phoneNumbers) map[p.id] = p
    return map
  }, [phoneNumbers])

  const unreadByInbox = useMemo(() => {
    const map: Record<string, boolean> = {}
    for (const c of conversations) {
      if (c.unread_count > 0) map[c.phone_number_id] = true
    }
    return map
  }, [conversations])

  // Sort helper — most recent first.
  const sortConversations = useCallback((list: Conversation[]) => {
    return [...list].sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bt - at
    })
  }, [])

  // ---- Realtime: conversations ----
  useEffect(() => {
    const channel = supabase
      .channel("conversations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          setConversations((prev) => {
            if (payload.eventType === "DELETE") {
              return prev.filter((c) => c.id !== (payload.old as Conversation).id)
            }
            const row = payload.new as Conversation
            // Preserve any joined phone_numbers we already have.
            const existing = prev.find((c) => c.id === row.id)
            const merged: Conversation = {
              ...row,
              phone_numbers:
                existing?.phone_numbers ?? phoneById[row.phone_number_id],
            }
            const without = prev.filter((c) => c.id !== row.id)
            return sortConversations([merged, ...without])
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, phoneById, sortConversations])

  // ---- Realtime: messages for the active conversation ----
  useEffect(() => {
    if (!selected) return
    const channel = supabase
      .channel(`messages:${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          const incoming = payload.new as Message
          setMessages((prev) => {
            // Skip if we already have it (e.g. our own optimistic/confirmed msg).
            if (prev.some((m) => m.id === incoming.id)) return prev
            return [...prev, incoming]
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, selected])

  // ---- Load messages + mark read when selecting a conversation ----
  const selectConversation = useCallback(
    async (c: Conversation) => {
      setSelected(c)
      setLoadingMessages(true)
      setMessages([])

      const { data } = await supabase
        .from("messages")
        .select(
          "id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at"
        )
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: true })

      setMessages((data ?? []) as Message[])
      setLoadingMessages(false)

      // Reset unread locally + via RPC.
      setConversations((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x))
      )
      await supabase.rpc("mark_conversation_read", { conversation_id: c.id })
    },
    [supabase]
  )

  // ---- Send (optimistic) ----
  const handleSend = useCallback(
    async (body: string) => {
      if (!selected) return
      setSending(true)

      const tempId = `temp-${Date.now()}`
      const optimistic: Message = {
        id: tempId,
        conversation_id: selected.id,
        phone_number_id: selected.phone_number_id,
        direction: "outbound",
        body,
        media_urls: null,
        status: "queued",
        telnyx_message_id: null,
        sent_at: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])

      const res = await sendMessage({
        conversationId: selected.id,
        phoneNumberId: selected.phone_number_id,
        to: selected.contact_number,
        body,
      })

      setMessages((prev) => {
        if (!res.ok) {
          return prev.map((m) =>
            m.id === tempId ? { ...m, status: "delivery_failed" } : m
          )
        }
        // Drop the optimistic temp row. The messages Realtime subscription may
        // have already inserted the real row (keyed by its real id) before this
        // action resolved — if so, don't add it again or we'd render two
        // children with the same key.
        const withoutTemp = prev.filter((m) => m.id !== tempId)
        if (withoutTemp.some((m) => m.id === res.message.id)) return withoutTemp
        return [...withoutTemp, res.message]
      })
      setSending(false)
    },
    [selected]
  )

  // ---- Delete the selected conversation ----
  const handleDeleteConversation = useCallback(async () => {
    if (!selected) return
    const id = selected.id

    // Optimistic: drop it from the list and clear the open thread.
    setConversations((prev) => prev.filter((c) => c.id !== id))
    setSelected(null)
    setMessages([])

    const res = await deleteConversation(id)
    if (!res.ok) {
      toast.error(res.error ?? "Could not delete conversation.")
      return
    }
    toast.success("Conversation deleted")
  }, [selected])

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
      <div className={cn("min-w-0 flex-1", !selected && "hidden sm:flex")}>
        <div className="flex h-full w-full flex-col">
          {/* Mobile back bar */}
          {selected && (
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="flex cursor-pointer items-center gap-1.5 border-b border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground sm:hidden"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
          <ChatView
            conversation={selected}
            phoneNumber={selected ? phoneById[selected.phone_number_id] : null}
            messages={messages}
            loading={loadingMessages}
            sending={sending}
            onSend={handleSend}
            onDeleteMessage={(id) => setMessages((prev) => prev.filter((m) => m.id !== id))}
            onResendMessage={(msg) => setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, status: "queued" } : m))}
            onDeleteConversation={handleDeleteConversation}
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
          // Find or refetch the conversation, then open it.
          const existing = conversations.find((c) => c.id === conversationId)
          if (existing) {
            selectConversation(existing)
          } else {
            const { data } = await supabase
              .from("conversations")
              .select(
                "id, phone_number_id, contact_number, last_message_at, last_message_text, unread_count, created_at, phone_numbers(label, color, id, phone_number, is_active)"
              )
              .eq("id", conversationId)
              .single()
            if (data) {
              const conv = {
                ...data,
                phone_numbers: Array.isArray(data.phone_numbers)
                  ? data.phone_numbers[0]
                  : data.phone_numbers,
              } as Conversation
              setConversations((prev) => sortConversations([conv, ...prev]))
              selectConversation(conv)
            }
          }
        }}
      />
    </div>
  )
}
