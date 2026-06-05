"use client"

import { format } from "date-fns"
import { AlertCircle, Check, CheckCheck, Clock, MoreVertical, RefreshCw, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
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
  onDelete,
  onResend,
}: {
  message: Message
  color: string
  grouped?: boolean
  onDelete?: (id: string) => void
  onResend?: (message: Message) => void
}) {
  const outbound = message.direction === "outbound"
  const failed = message.status === "delivery_failed"
  const time = message.created_at ? format(new Date(message.created_at), "p") : ""

  return (
    <div
      className={cn(
        "group flex w-full gap-1",
        outbound ? "justify-end" : "justify-start",
        grouped ? "mt-0.5" : "mt-3"
      )}
    >
      {/* Menu left of bubble for outbound */}
      {outbound && (
        <MessageMenu
          messageId={message.id}
          failed={failed}
          onDelete={onDelete}
          onResend={() => onResend?.(message)}
        />
      )}

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

      {/* Menu right of bubble for inbound */}
      {!outbound && (
        <MessageMenu
          messageId={message.id}
          failed={false}
          onDelete={onDelete}
          onResend={undefined}
        />
      )}
    </div>
  )
}

function MessageMenu({
  messageId,
  failed,
  onDelete,
  onResend,
}: {
  messageId: string
  failed: boolean
  onDelete?: (id: string) => void
  onResend?: () => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
          aria-label="Message options"
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" side="top" className="w-36">
        {failed && onResend && (
          <DropdownMenuItem
            className="cursor-pointer gap-2 text-sm"
            onClick={onResend}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Resend
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-sm text-destructive focus:text-destructive"
          onClick={() => onDelete?.(messageId)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
