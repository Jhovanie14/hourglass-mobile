"use client"

import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Send, Trash2 } from "lucide-react"
import type { Conversation, Message } from "@/types/conversations"

export function ThreadView({
  conversation,
  messages,
  loading,
  sending,
  onBack,
  onSend,
  onDeleteMessage,
  onDeleteConversation,
}: {
  conversation: Conversation
  messages: Message[]
  loading: boolean
  sending: boolean
  onBack: () => void
  onSend: (body: string) => void
  onDeleteMessage: (id: string) => void
  onDeleteConversation: () => void
}) {
  const [draft, setDraft] = useState("")
  // Two-step inline confirm. A window.confirm modal inside a 340px
  // cross-origin iframe blocks the whole panel and is disproportionate.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  function submit() {
    const body = draft.trim()
    if (!body || sending) return
    onSend(body)
    setDraft("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-neutral-800 px-2 py-1.5">
        <button
          type="button"
          onClick={onBack}
          className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
          aria-label="Back to conversations"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-neutral-200">
          {conversation.contact_number}
          {conversation.phone_numbers?.label && (
            <span className="text-neutral-500">
              {" · "}
              {conversation.phone_numbers.label}
            </span>
          )}
        </span>
        {confirmingDelete ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={onDeleteConversation}
              className="rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
            >
              Delete?
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="rounded px-1.5 py-0.5 text-[10px] text-neutral-400"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="shrink-0 rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-red-400"
            aria-label="Delete conversation"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {loading ? (
          <p className="text-center text-xs text-neutral-500">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-xs text-neutral-500">No messages yet.</p>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "outbound"
            const deleteButton = (
              <button
                type="button"
                onClick={() => onDeleteMessage(m.id)}
                className="shrink-0 p-0.5 text-neutral-600 opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                aria-label="Delete message"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )
            return (
              <div
                key={m.id}
                className={`group flex items-center gap-1 ${
                  outbound ? "justify-end" : "justify-start"
                }`}
              >
                {outbound && deleteButton}
                <span
                  className={`max-w-[80%] rounded-lg px-2 py-1 text-[11px] ${
                    outbound
                      ? m.status === "delivery_failed"
                        ? "bg-red-500/15 text-red-300"
                        : "bg-sky-600 text-white"
                      : "bg-neutral-800 text-neutral-200"
                  }`}
                >
                  {m.body}
                  {m.status === "delivery_failed" && (
                    <span className="mt-0.5 block text-[9px] opacity-80">
                      Not delivered
                    </span>
                  )}
                </span>
                {!outbound && deleteButton}
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-1.5 border-t border-neutral-800 px-2 py-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="Message…"
          className="min-w-0 flex-1 rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim() || sending}
          className="shrink-0 rounded bg-sky-600 p-1.5 text-white transition disabled:opacity-40"
          aria-label="Send message"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}
