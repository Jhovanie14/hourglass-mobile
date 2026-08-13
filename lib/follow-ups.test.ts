import { describe, it, expect } from "vitest"
import { groupFollowUps } from "./follow-ups"
import type { Disposition } from "./dispositions"

function row(id: string, followUpAt: string | null): Disposition {
  return {
    id,
    telnyx_call_id: `call-${id}`,
    outcome: "answered",
    notes: null,
    follow_up_at: followUpAt,
    contact_number: "+12105551234",
    direction: "inbound",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  }
}

describe("groupFollowUps", () => {
  // Local-time "now": 14 Aug 2026, 12:00.
  const now = new Date("2026-08-14T12:00:00")

  it("splits into overdue (< now), today (later today), upcoming (later days)", () => {
    const groups = groupFollowUps(
      [
        row("tomorrow", "2026-08-15T09:00:00"),
        row("later-today", "2026-08-14T15:00:00"),
        row("earlier-today", "2026-08-14T09:00:00"),
        row("yesterday", "2026-08-13T09:00:00"),
      ],
      now
    )
    expect(groups.overdue.map((r) => r.id)).toEqual(["yesterday", "earlier-today"])
    expect(groups.today.map((r) => r.id)).toEqual(["later-today"])
    expect(groups.upcoming.map((r) => r.id)).toEqual(["tomorrow"])
  })

  it("sorts ascending inside each group", () => {
    const groups = groupFollowUps(
      [
        row("b", "2026-08-20T10:00:00"),
        row("a", "2026-08-16T10:00:00"),
        row("c", "2026-08-25T10:00:00"),
      ],
      now
    )
    expect(groups.upcoming.map((r) => r.id)).toEqual(["a", "b", "c"])
  })

  it("drops rows without a follow-up", () => {
    const groups = groupFollowUps([row("none", null)], now)
    expect(groups).toEqual({ overdue: [], today: [], upcoming: [] })
  })
})
