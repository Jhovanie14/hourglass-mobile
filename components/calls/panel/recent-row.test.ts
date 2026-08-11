import { describe, expect, it } from "vitest"
import { formatRecentRow, type RecentCall } from "./recent-row"

const base: RecentCall = {
  id: "1",
  telnyx_call_id: "call-1",
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
  it("exposes the original line as callbackFrom, null when the join is missing", () => {
    expect(formatRecentRow(base).callbackFrom).toBe("+15559999999")
    expect(formatRecentRow({ ...base, phone_numbers: null }).callbackFrom).toBeNull()
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
  it("labels and colour-codes each status", () => {
    const tone = (status: RecentCall["status"]) =>
      formatRecentRow({ ...base, status })
    expect(tone("completed").statusLabel).toBe("Completed")
    expect(tone("completed").statusTone).toBe("good")
    expect(tone("answered").statusTone).toBe("good")
    expect(tone("missed").statusTone).toBe("bad")
    expect(tone("failed").statusTone).toBe("bad")
    expect(tone("declined").statusTone).toBe("warn")
    expect(tone("voicemail").statusLabel).toBe("Voicemail")
    expect(tone("voicemail").statusTone).toBe("info")
    expect(tone("initiated").statusTone).toBe("neutral")
  })
  it("falls back to a neutral pill for unknown statuses", () => {
    const row = formatRecentRow({ ...base, status: "ringing" as RecentCall["status"] })
    expect(row.statusLabel).toBe("Ringing")
    expect(row.statusTone).toBe("neutral")
  })
  it("shows a placeholder title when the number is empty", () => {
    const row = formatRecentRow({ ...base, contact_number: "" })
    expect(row.title).toBe("Unknown")
    expect(row.callbackTo).toBe("")
  })
  it("prefers the saved contact name for the title", () => {
    const row = formatRecentRow({ ...base, contact_name: "Jane Doe" })
    expect(row.title).toBe("Jane Doe")
    expect(row.callbackTo).toBe("+15551230000")
  })
})
