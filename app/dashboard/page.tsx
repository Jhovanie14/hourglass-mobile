import { startOfDay } from "date-fns"
import { createClient } from "@/lib/server"
import {
  StatsCards,
  type DashboardStats,
} from "@/components/dashboard/stats-cards"
import {
  RecentConversations,
  type ConversationWithInbox,
} from "@/components/dashboard/recent-conversations"
import {
  RecentCalls,
  type CallWithInbox,
} from "@/components/dashboard/recent-calls"
import {
  InboxBreakdown,
  type InboxSummary,
} from "@/components/dashboard/inbox-breakdown"

type PhoneNumber = {
  id: string
  label: string
  phone_number: string
  color: string
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const todayIso = startOfDay(new Date()).toISOString()

  const [
    phoneNumbersRes,
    conversationsTodayRes,
    unreadRowsRes,
    missedTodayRes,
    callsTodayRes,
    recentConversationsRes,
    recentCallsRes,
  ] = await Promise.all([
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso),
    supabase.from("conversations").select("phone_number_id, unread_count"),
    supabase
      .from("calls")
      .select("phone_number_id")
      .eq("status", "missed")
      .gte("created_at", todayIso),
    supabase
      .from("calls")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayIso),
    supabase
      .from("conversations")
      .select(
        "id, contact_number, last_message_at, last_message_text, unread_count, phone_numbers(label, color)"
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(5),
    supabase
      .from("calls")
      .select(
        "id, contact_number, direction, status, duration_seconds, created_at, phone_numbers(label, color)"
      )
      .order("created_at", { ascending: false })
      .limit(5),
  ])

  const phoneNumbers = (phoneNumbersRes.data ?? []) as PhoneNumber[]
  const unreadRows = (unreadRowsRes.data ?? []) as {
    phone_number_id: string
    unread_count: number | null
  }[]
  const missedRows = (missedTodayRes.data ?? []) as {
    phone_number_id: string
  }[]

  // Aggregate unread + missed per inbox (and globally) in one pass each.
  const unreadByInbox = new Map<string, number>()
  let unreadTotal = 0
  for (const row of unreadRows) {
    const count = row.unread_count ?? 0
    unreadTotal += count
    unreadByInbox.set(
      row.phone_number_id,
      (unreadByInbox.get(row.phone_number_id) ?? 0) + count
    )
  }

  const missedByInbox = new Map<string, number>()
  for (const row of missedRows) {
    missedByInbox.set(
      row.phone_number_id,
      (missedByInbox.get(row.phone_number_id) ?? 0) + 1
    )
  }

  const stats: DashboardStats = {
    totalConversationsToday: conversationsTodayRes.count ?? 0,
    unreadMessages: unreadTotal,
    missedCallsToday: missedRows.length,
    totalCallsToday: callsTodayRes.count ?? 0,
  }

  const inboxes: InboxSummary[] = phoneNumbers.map((pn) => ({
    id: pn.id,
    label: pn.label,
    phone_number: pn.phone_number,
    color: pn.color,
    unreadMessages: unreadByInbox.get(pn.id) ?? 0,
    missedCallsToday: missedByInbox.get(pn.id) ?? 0,
  }))

  // Supabase types embedded relations as arrays; normalize to a single object.
  const recentConversations = (recentConversationsRes.data ?? []).map(
    (c) => ({
      ...c,
      phone_numbers: Array.isArray(c.phone_numbers)
        ? (c.phone_numbers[0] ?? null)
        : c.phone_numbers,
    })
  ) as ConversationWithInbox[]

  const recentCalls = (recentCallsRes.data ?? []).map((call) => ({
    ...call,
    phone_numbers: Array.isArray(call.phone_numbers)
      ? (call.phone_numbers[0] ?? null)
      : call.phone_numbers,
  })) as CallWithInbox[]

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Activity across all inboxes.
        </p>
      </div>

      <StatsCards stats={stats} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RecentConversations conversations={recentConversations} />
        <RecentCalls calls={recentCalls} />
      </div>

      <InboxBreakdown inboxes={inboxes} />
    </div>
  )
}
