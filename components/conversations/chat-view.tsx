"use client"

import { useEffect, useRef, useState } from "react"
import {
  ArrowDown,
  BellOff,
  BellRing,
  MessageSquare,
  MoreVertical,
  Paperclip,
  Phone,
  SendHorizonal,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  resendMessage,
  setContactOptOut,
} from "@/app/dashboard/conversations/actions"
import { MessageBubble } from "./message-bubble"
import type {
  Conversation,
  Message,
  PhoneNumber,
} from "@/types/conversations"

const SMS_LIMIT = 160

export function ChatView({
  conversation,
  phoneNumber,
  messages,
  loading,
  sending,
  onSend,
  onDeleteMessage,
  onResendMessage,
  onDeleteConversation,
}: {
  conversation: Conversation | null
  phoneNumber: PhoneNumber | null
  messages: Message[]
  loading?: boolean
  sending?: boolean
  onSend: (body: string) => void
  onDeleteMessage?: (id: string) => void
  onResendMessage?: (message: Message) => void
  onDeleteConversation?: () => void
}) {
  const [draft, setDraft] = useState("")
  const [showJump, setShowJump] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const color = phoneNumber?.color ?? "#6366f1"

  function scrollToBottom(behavior: ScrollBehavior = "auto") {
    bottomRef.current?.scrollIntoView({ behavior })
  }

  // Auto-scroll when conversation changes or a new message arrives,
  // unless the user has scrolled up.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      scrollToBottom()
      setShowJump(false)
    } else {
      setShowJump(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, conversation?.id])

  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const nearBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) setShowJump(false)
  }

  // Deletion is owned by the parent (useConversations → DELETE /api/messages/[id]).
  // ChatView used to call the deleteMessage server action itself; doing both
  // would fire two deletes, the second failing and rolling the UI back.
  function handleDelete(id: string) {
    onDeleteMessage?.(id)
  }

  async function handleResend(message: Message) {
    onResendMessage?.(message)
    await resendMessage(message.id)
  }

  async function handleSetOptOut(optedOut: boolean) {
    if (!conversation) return
    const res = await setContactOptOut(conversation.contact_number, optedOut)
    if (res.ok) {
      toast(
        optedOut
          ? "Contact opted out — they will no longer receive texts."
          : "Contact re-subscribed — they can receive texts again."
      )
    } else {
      toast.error(res.error ?? "Could not update opt-out status.")
    }
  }

  function submit() {
    const body = draft.trim()
    if (!body || sending) return
    onSend(body)
    setDraft("")
    requestAnimationFrame(() => scrollToBottom("smooth"))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  // Empty state — no conversation selected.
  if (!conversation) {
    return (
      <div className="hidden flex-1 flex-col items-center justify-center gap-2 bg-background p-8 text-center sm:flex">
        <MessageSquare className="h-12 w-12 text-muted-foreground/40" />
        <p className="text-base font-medium text-foreground">
          Select a conversation
        </p>
        <p className="text-sm text-muted-foreground">
          Choose a conversation from the list to start messaging
        </p>
      </div>
    )
  }

  return (
    // min-h-0 is load-bearing: as a column flex item this defaults to
    // min-height:auto and refuses to shrink below its content, so the thread
    // scroller below ends up taller than the column and never scrolls — the
    // page scrolls instead, dragging the conversation list off screen.
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-base font-semibold text-foreground">
              {conversation.contact_number}
            </span>
            {phoneNumber && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium text-white"
                style={{ backgroundColor: phoneNumber.color }}
              >
                {phoneNumber.label}
              </span>
            )}
          </div>
          {phoneNumber && (
            <p className="truncate text-xs text-muted-foreground">
              via {phoneNumber.phone_number}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Call">
                <Phone className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More options">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-sm text-destructive focus:text-destructive"
                onClick={() => handleSetOptOut(true)}
              >
                <BellOff className="h-3.5 w-3.5" />
                Mark as opted out
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-sm"
                onClick={() => handleSetOptOut(false)}
              >
                <BellRing className="h-3.5 w-3.5" />
                Re-subscribe to texts
              </DropdownMenuItem>
              <DropdownMenuItem
                className="cursor-pointer gap-2 text-sm text-destructive focus:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete conversation
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Thread */}
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-3"
        >
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className={cn("flex", i % 2 ? "justify-end" : "justify-start")}
                >
                  <Skeleton
                    className="h-10 rounded-2xl"
                    style={{ width: `${40 + (i % 3) * 15}%` }}
                  />
                </div>
              ))}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No messages yet. Say hello!
              </p>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  color={color}
                  grouped={i > 0 && messages[i - 1].direction === m.direction}
                  onDelete={handleDelete}
                  onResend={handleResend}
                />
              ))}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {showJump && (
          <button
            type="button"
            onClick={() => {
              scrollToBottom("smooth")
              setShowJump(false)
            }}
            className="absolute right-4 bottom-4 inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-colors duration-200 hover:bg-primary/90"
          >
            <ArrowDown className="h-3.5 w-3.5" />
            New message
          </button>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled
                aria-label="Attach file"
                className="shrink-0"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>

          <div className="flex-1">
            <label htmlFor="message-input" className="sr-only">
              Type a message
            </label>
            <Textarea
              id="message-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              rows={1}
              className="max-h-32 min-h-10 resize-none"
            />
            {draft.length >= SMS_LIMIT - 20 && (
              <p
                className={cn(
                  "mt-1 text-right text-xs",
                  draft.length > SMS_LIMIT
                    ? "text-destructive"
                    : "text-muted-foreground"
                )}
              >
                {draft.length}/{SMS_LIMIT}
              </p>
            )}
          </div>

          <Button
            type="button"
            size="icon"
            onClick={submit}
            disabled={!draft.trim() || sending}
            aria-label="Send message"
            className="shrink-0 cursor-pointer"
          >
            <SendHorizonal className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Delete-conversation confirmation */}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the conversation with{" "}
              <span className="font-medium text-foreground">
                {conversation.contact_number}
              </span>{" "}
              and all its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDelete(false)}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false)
                onDeleteConversation?.()
              }}
              className="cursor-pointer"
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
