"use client"

import { format } from "date-fns"
import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import type { Message, MessageStatus } from "@/types/conversations"

function StatusIcon({ status }: { status: MessageStatus }) {
  switch (status) {
    case "queued":
      return <Clock className="h-3 w-3" aria-label="Queued" />
    case "sent":
      return <Check className="h-3 w-3" aria-label="Sent" />
    case "delivered":
      return <CheckCheck className="h-3 w-3" aria-label="Delivered" />
    case "delivery_failed":
      return (
        <AlertCircle
          className="h-3 w-3 text-destructive"
          aria-label="Failed to deliver"
        />
      )
    default:
      return null
  }
}

export function MessageBubble({
  message,
  color,
  grouped,
}: {
  message: Message
  /** Inbox color — used as the outbound bubble background. */
  color: string
  /** True when the previous message was the same direction (tighter spacing). */
  grouped?: boolean
}) {
  const outbound = message.direction === "outbound"
  const time = message.created_at ? format(new Date(message.created_at), "p") : ""

  return (
    <div
      className={cn(
        "flex w-full",
        outbound ? "justify-end" : "justify-start",
        grouped ? "mt-0.5" : "mt-3"
      )}
    >
      <div
        className={cn(
          "flex max-w-[75%] flex-col gap-0.5",
          outbound ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2 text-sm break-words whitespace-pre-wrap",
            outbound
              ? "rounded-br-sm text-white"
              : "rounded-bl-sm bg-muted text-foreground"
          )}
          style={outbound ? { backgroundColor: color } : undefined}
        >
          {message.body}
        </div>

        <div
          className={cn(
            "flex items-center gap-1 px-1 text-[11px] text-muted-foreground",
            outbound ? "flex-row-reverse" : "flex-row"
          )}
        >
          <span>{time}</span>
          {outbound && <StatusIcon status={message.status} />}
        </div>
      </div>
    </div>
  )
}
