import { isSameDay } from "date-fns"
import type { Disposition } from "./dispositions"

export type FollowUpGroups = {
  overdue: Disposition[]
  today: Disposition[]
  upcoming: Disposition[]
}

/**
 * Split the agent's dispositions into Overdue / Today / Upcoming buckets,
 * each ascending by due time. Rows without a follow-up are dropped.
 * "Today" means due later today; anything already past `now` is overdue
 * even when it's the same calendar day.
 */
export function groupFollowUps(rows: Disposition[], now: Date): FollowUpGroups {
  const dated = rows
    .filter((r): r is Disposition & { follow_up_at: string } => Boolean(r.follow_up_at))
    .sort(
      (a, b) => new Date(a.follow_up_at).getTime() - new Date(b.follow_up_at).getTime()
    )

  const groups: FollowUpGroups = { overdue: [], today: [], upcoming: [] }
  for (const row of dated) {
    const due = new Date(row.follow_up_at)
    if (due.getTime() < now.getTime()) groups.overdue.push(row)
    else if (isSameDay(due, now)) groups.today.push(row)
    else groups.upcoming.push(row)
  }
  return groups
}
