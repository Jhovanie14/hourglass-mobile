import Link from "next/link"
import { formatDistanceToNow } from "date-fns"
import { ArrowDownLeft, ArrowUpRight, Phone } from "lucide-react"
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export type CallWithInbox = {
  id: string
  contact_number: string
  direction: string
  status: string
  duration_seconds: number | null
  created_at: string
  phone_numbers: { label: string; color: string } | null
}

function formatDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "—"
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "answered") return "default"
  if (status === "missed") return "destructive"
  return "secondary"
}

export function RecentCalls({ calls }: { calls: CallWithInbox[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Calls</CardTitle>
      </CardHeader>

      <CardContent className="px-0">
        {calls.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Phone className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No calls yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {calls.map((call) => {
              const inbound = call.direction === "inbound"
              return (
                <li
                  key={call.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {inbound ? (
                      <ArrowDownLeft className="h-4 w-4 shrink-0 text-emerald-500" />
                    ) : (
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-blue-500" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {call.contact_number}
                        </span>
                        {call.phone_numbers && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{
                              backgroundColor: call.phone_numbers.color,
                            }}
                          >
                            {call.phone_numbers.label}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(call.status)}>
                          {call.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatDuration(call.duration_seconds)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(call.created_at), {
                      addSuffix: true,
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      <CardFooter>
        <Link
          href="/dashboard/calls"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </CardFooter>
    </Card>
  )
}
