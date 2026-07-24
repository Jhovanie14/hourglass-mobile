import { format, isSameDay, differenceInDays } from "date-fns"
import type { Conversation } from "@/types/conversations"

export type ConversationRowView = {
  title: string
  preview: string
  timeText: string
  lineLabel: string | null
  lineColor: string | null
  unread: boolean
}

/** The panel is 340px wide — anything longer than this cannot render on one line. */
const PREVIEW_MAX = 40

function truncate(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text
}

/**
 * Compact relative time for a narrow row: "2m", "3h", "Tue", "Jun 2".
 * date-fns's formatDistanceToNow ("about 2 hours ago") is far too wide here,
 * which is why this does not reuse recent-row.ts's approach.
 */
function compactTime(iso: string | null, now: Date): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""

  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000)
  if (mins < 1) return "now"
  if (mins < 60) return `${mins}m`
  if (isSameDay(d, now)) return `${Math.floor(mins / 60)}h`
  if (differenceInDays(now, d) < 7) return format(d, "EEE")
  return format(d, "MMM d")
}

/** Shape one conversation for the panel's Messages list. Pure. */
export function formatConversationRow(
  c: Conversation,
  now: Date = new Date()
): ConversationRowView {
  return {
    title: c.contact_number || "Unknown",
    preview: c.last_message_text
      ? truncate(c.last_message_text)
      : "No messages yet",
    timeText: compactTime(c.last_message_at, now),
    lineLabel: c.phone_numbers?.label ?? null,
    lineColor: c.phone_numbers?.color ?? null,
    unread: c.unread_count > 0,
  }
}
