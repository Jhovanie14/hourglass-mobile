import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { MessageSquare } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card"

export type ConversationWithInbox = {
  id: string
  contact_number: string
  last_message_at: string | null
  last_message_text: string | null
  unread_count: number
  phone_numbers: { label: string; color: string } | null
}

function truncate(text: string | null, max = 40) {
  if (!text) return "No messages yet"
  return text.length > max ? `${text.slice(0, max)}…` : text
}

export function RecentConversations({
  conversations,
}: {
  conversations: ConversationWithInbox[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Conversations</CardTitle>
      </CardHeader>

      <CardContent className="px-0">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              No conversations yet
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {conversations.map((c) => (
              <li
                key={c.id}
                className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{c.contact_number}</span>
                    {c.phone_numbers && (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                        style={{ backgroundColor: c.phone_numbers.color }}
                      >
                        {c.phone_numbers.label}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">
                    {truncate(c.last_message_text)}
                  </p>
                </div>
                {c.last_message_at && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(c.last_message_at), {
                      addSuffix: true,
                    })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <CardFooter>
        <Link
          href="/dashboard/conversations"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </CardFooter>
    </Card>
  )
}
