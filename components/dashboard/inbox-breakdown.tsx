import Link from "next/link"
import { MailOpen, PhoneMissed } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export type InboxSummary = {
  id: string
  label: string
  phone_number: string
  color: string
  unreadMessages: number
  missedCallsToday: number
}

export function InboxBreakdown({ inboxes }: { inboxes: InboxSummary[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {inboxes.map((inbox) => (
        <Card
          key={inbox.id}
          className="border-l-4"
          style={{ borderLeftColor: inbox.color }}
        >
          <CardHeader>
            <CardTitle>{inbox.label}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {inbox.phone_number}
            </p>
          </CardHeader>

          <CardContent className="flex gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <MailOpen className="h-4 w-4" />
                <span className="text-xs">Unread</span>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {inbox.unreadMessages}
              </p>
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <PhoneMissed className="h-4 w-4" />
                <span className="text-xs">Missed today</span>
              </div>
              <p className="text-2xl font-bold tabular-nums">
                {inbox.missedCallsToday}
              </p>
            </div>
          </CardContent>

          <CardFooter>
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/conversations?inbox=${inbox.id}`}>
                Go to inbox
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
