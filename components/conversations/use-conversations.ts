"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { toast } from "sonner"
import type { Conversation, Message, PhoneNumber } from "@/types/conversations"

const MESSAGE_COLUMNS =
  "id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at"

const CONVERSATION_COLUMNS =
  "id, phone_number_id, contact_number, last_message_at, last_message_text, unread_count, created_at, phone_numbers(id, label, phone_number, color, is_active)"

/**
 * Shared SMS orchestration for the dashboard page and the extension panel:
 * the conversation list, both Realtime channels, mark-read, optimistic send,
 * compose, and deletes.
 *
 * Mutations go through /api/messages/* rather than the dashboard's server
 * actions, because the panel runs in a cross-origin iframe with no cookies and
 * server actions cannot authenticate there. getRequestUserId /
 * createRequestScopedClient accept a cookie session OR a Bearer token, so one
 * path serves both callers.
 */
export function useConversations({
  supabase,
  phoneNumbers,
  initialConversations,
  accessToken,
}: {
  supabase: SupabaseClient
  phoneNumbers: PhoneNumber[]
  initialConversations: Conversation[]
  /** Panel only. Omit on the desktop, where same-origin cookies authenticate. */
  accessToken?: string
}) {
  const [conversations, setConversations] =
    useState<Conversation[]>(initialConversations)
  const [selected, setSelected] = useState<Conversation | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)

  // Same-origin fetch from the dashboard carries cookies; the panel iframe must
  // present the Bearer token instead.
  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = {}
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`
    return headers
  }, [accessToken])

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

  // Conversations with anything unread — NOT the sum of unread messages, so the
  // tab badge and the per-line dots agree.
  const totalUnread = useMemo(
    () => conversations.filter((c) => c.unread_count > 0).length,
    [conversations]
  )

  const sortConversations = useCallback((list: Conversation[]) => {
    return [...list].sort((a, b) => {
      const at = a.last_message_at ? new Date(a.last_message_at).getTime() : 0
      const bt = b.last_message_at ? new Date(b.last_message_at).getTime() : 0
      return bt - at
    })
  }, [])

  /**
   * Reload the list. Returns the fresh rows as well as storing them — callers
   * that need to act on a just-created conversation cannot read `conversations`
   * immediately after, because that state has not committed yet.
   */
  const refresh = useCallback(async (): Promise<Conversation[]> => {
    const { data } = await supabase
      .from("conversations")
      .select(CONVERSATION_COLUMNS)
      .order("last_message_at", { ascending: false, nullsFirst: false })

    const rows = (data ?? []).map((row) => ({
      ...row,
      phone_numbers: Array.isArray(row.phone_numbers)
        ? row.phone_numbers[0]
        : row.phone_numbers,
    })) as Conversation[]

    setConversations(rows)
    return rows
  }, [supabase])

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
  // INSERT *and* DELETE: a message deleted elsewhere used to linger until
  // reload, which is glaring with the panel and the website open side by side.
  useEffect(() => {
    if (!selected) return
    const channel = supabase
      .channel(`messages:${selected.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const gone = payload.old as { id: string }
            setMessages((prev) => prev.filter((m) => m.id !== gone.id))
            return
          }
          if (payload.eventType !== "INSERT") return
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

  // ---- Load messages + mark read when selecting ----
  const selectConversation = useCallback(
    async (c: Conversation) => {
      setSelected(c)
      setLoadingMessages(true)
      setMessages([])

      const { data } = await supabase
        .from("messages")
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", c.id)
        .order("created_at", { ascending: true })

      setMessages((data ?? []) as Message[])
      setLoadingMessages(false)

      setConversations((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, unread_count: 0 } : x))
      )
      await supabase.rpc("mark_conversation_read", { conversation_id: c.id })
    },
    [supabase]
  )

  const clearSelection = useCallback(() => {
    setSelected(null)
    setMessages([])
  }, [])

  // ---- Send (optimistic) ----
  const send = useCallback(
    /**
     * `into` overrides the selected conversation. Compose needs it: it selects a
     * freshly created conversation and sends in the same tick, before the
     * `selected` state this closure captured has committed — without the
     * override the first message of a new thread would silently do nothing.
     */
    async (body: string, into?: Conversation) => {
      const target = into ?? selected
      if (!target) return
      setSending(true)

      const tempId = `temp-${Date.now()}`
      const optimistic: Message = {
        id: tempId,
        conversation_id: target.id,
        phone_number_id: target.phone_number_id,
        direction: "outbound",
        body,
        media_urls: null,
        status: "queued",
        telnyx_message_id: null,
        sent_at: null,
        created_at: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, optimistic])

      let ok = false
      let saved: Message | null = null
      try {
        const res = await fetch("/api/messages/send", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            conversationId: target.id,
            phoneNumberId: target.phone_number_id,
            to: target.contact_number,
            body,
          }),
        })
        const json = await res.json()
        ok = res.ok
        saved = ok ? (json.message as Message) : null
        if (!ok) toast.error(json.error ?? "Could not send message.")
      } catch {
        toast.error("Could not send message.")
      }

      setMessages((prev) => {
        if (!ok || !saved) {
          return prev.map((m) =>
            m.id === tempId ? { ...m, status: "delivery_failed" } : m
          )
        }
        // Drop the optimistic temp row. The messages Realtime subscription may
        // have already inserted the real row (keyed by its real id) before this
        // request resolved — if so, don't add it again or we'd render two
        // children with the same key.
        const withoutTemp = prev.filter((m) => m.id !== tempId)
        if (withoutTemp.some((m) => m.id === saved!.id)) return withoutTemp
        return [...withoutTemp, saved!]
      })
      setSending(false)
    },
    [selected, authHeaders]
  )

  // ---- Compose: get-or-create a conversation ----
  const startConversation = useCallback(
    async ({
      phoneNumberId,
      contactNumber,
    }: {
      phoneNumberId: string
      contactNumber: string
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/messages/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({ phoneNumberId, contactNumber }),
        })
        const json = await res.json()
        if (!res.ok) {
          toast.error(json.error ?? "Could not start conversation.")
          return null
        }
        await refresh()
        return json.conversationId as string
      } catch {
        toast.error("Could not start conversation.")
        return null
      }
    },
    [authHeaders, refresh]
  )

  // ---- Deletes (optimistic, rolled back on failure) ----
  const deleteMessage = useCallback(
    async (id: string) => {
      const snapshot = messages
      setMessages((prev) => prev.filter((m) => m.id !== id))
      try {
        const res = await fetch(`/api/messages/${id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
        if (!res.ok) {
          const json = await res.json()
          setMessages(snapshot)
          toast.error(json.error ?? "Could not delete message.")
        }
      } catch {
        setMessages(snapshot)
        toast.error("Could not delete message.")
      }
    },
    [messages, authHeaders]
  )

  const deleteConversation = useCallback(
    async (id: string) => {
      const snapshot = conversations
      setConversations((prev) => prev.filter((c) => c.id !== id))
      if (selected?.id === id) clearSelection()
      try {
        const res = await fetch(`/api/messages/conversations/${id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
        if (!res.ok) {
          const json = await res.json()
          setConversations(snapshot)
          toast.error(json.error ?? "Could not delete conversation.")
          return
        }
        toast.success("Conversation deleted")
      } catch {
        setConversations(snapshot)
        toast.error("Could not delete conversation.")
      }
    },
    [conversations, selected, clearSelection, authHeaders]
  )

  /**
   * Flip a message back to "queued" for the dashboard's resend affordance.
   * Resend itself remains a server action (desktop-only, out of scope here);
   * this only keeps the optimistic UI honest now that the layout no longer
   * owns the messages state.
   */
  const markMessageQueued = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, status: "queued" } : m))
    )
  }, [])

  // Realtime sockets drop while a widget sits on a page for hours — heal on focus.
  useEffect(() => {
    const onFocus = () => {
      refresh()
    }
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [refresh])

  return {
    conversations,
    selected,
    messages,
    loadingMessages,
    sending,
    unreadByInbox,
    totalUnread,
    selectConversation,
    clearSelection,
    send,
    startConversation,
    deleteMessage,
    deleteConversation,
    markMessageQueued,
    refresh,
  }
}
