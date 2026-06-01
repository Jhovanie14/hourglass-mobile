import {
  MessageSquare,
  MailOpen,
  PhoneMissed,
  Phone,
  type LucideIcon,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export type DashboardStats = {
  totalConversationsToday: number
  unreadMessages: number
  missedCallsToday: number
  totalCallsToday: number
}

type StatCard = {
  label: string
  value: number
  icon: LucideIcon
  alertWhenPositive?: boolean
}

function StatCardItem({ label, value, icon: Icon, alertWhenPositive }: StatCard) {
  const showAlert = alertWhenPositive && value > 0

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-start justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-3xl font-bold tabular-nums">{value}</span>
            {showAlert && (
              <Badge variant="destructive" className="bg-destructive/15">
                New
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      </CardContent>
    </Card>
  )
}

export function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards: StatCard[] = [
    {
      label: "Conversations Today",
      value: stats.totalConversationsToday,
      icon: MessageSquare,
    },
    {
      label: "Unread Messages",
      value: stats.unreadMessages,
      icon: MailOpen,
      alertWhenPositive: true,
    },
    {
      label: "Missed Calls Today",
      value: stats.missedCallsToday,
      icon: PhoneMissed,
      alertWhenPositive: true,
    },
    {
      label: "Total Calls Today",
      value: stats.totalCallsToday,
      icon: Phone,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <StatCardItem key={card.label} {...card} />
      ))}
    </div>
  )
}
