import { describe, expect, it } from "vitest"
import { formatRecentRow, type RecentCall } from "./recent-row"

const base: RecentCall = {
  id: "1",
  contact_number: "+15551230000",
  direction: "inbound",
  status: "completed",
  started_at: "2026-07-01T10:00:00.000Z",
  created_at: "2026-07-01T10:00:05.000Z",
  phone_numbers: { label: "Sales", phone_number: "+15559999999", color: "#000" },
}

describe("formatRecentRow", () => {
  it("flags missed inbound calls", () => {
    const row = formatRecentRow({ ...base, status: "missed" })
    expect(row.missed).toBe(true)
    expect(row.directionIcon).toBe("in")
    expect(row.callbackTo).toBe("+15551230000")
    expect(row.lineLabel).toBe("Sales")
  })
  it("marks outbound direction and non-missed", () => {
    const row = formatRecentRow({ ...base, direction: "outbound", status: "completed" })
    expect(row.directionIcon).toBe("out")
    expect(row.missed).toBe(false)
  })
  it("falls back to created_at when started_at is null", () => {
    const row = formatRecentRow({ ...base, started_at: null })
    expect(row.timeText.length).toBeGreaterThan(0)
  })
  it("hides the line label when the join is missing", () => {
    const row = formatRecentRow({ ...base, phone_numbers: null })
    expect(row.lineLabel).toBeNull()
  })
  it("shows a placeholder title when the number is empty", () => {
    const row = formatRecentRow({ ...base, contact_number: "" })
    expect(row.title).toBe("Unknown")
    expect(row.callbackTo).toBe("")
  })
})
