import { formatDistanceToNow } from "date-fns"
import type { CallStatus } from "@/types/calls"

export type RecentCall = {
  id: string
  contact_number: string
  direction: "inbound" | "outbound"
  status: CallStatus
  started_at: string | null
  created_at: string
  phone_numbers?: { label: string; phone_number: string; color: string } | null
}

export type RecentRowView = {
  title: string
  missed: boolean
  directionIcon: "in" | "out"
  lineLabel: string | null
  timeText: string
  callbackTo: string
  /** The line this call used — call back from it so multi-brand callers see the number they dialed. Null for legacy rows missing the join. */
  callbackFrom: string | null
}

/** Shape one call row for the Recent tab. Pure + defensive against legacy rows. */
export function formatRecentRow(call: RecentCall): RecentRowView {
  const ts = call.started_at ?? call.created_at
  let timeText = ""
  if (ts) {
    const d = new Date(ts)
    if (!Number.isNaN(d.getTime())) {
      timeText = formatDistanceToNow(d, { addSuffix: true })
    }
  }
  return {
    title: call.contact_number || "Unknown",
    missed: call.status === "missed",
    directionIcon: call.direction === "outbound" ? "out" : "in",
    lineLabel: call.phone_numbers?.label ?? null,
    timeText,
    callbackTo: call.contact_number,
    callbackFrom: call.phone_numbers?.phone_number ?? null,
  }
}
