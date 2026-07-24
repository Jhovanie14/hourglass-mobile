import { describe, it, expect } from "vitest"
import { formatConversationRow } from "./conversation-row"
import type { Conversation } from "@/types/conversations"

const NOW = new Date("2026-07-25T12:00:00Z")

function conv(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c1",
    phone_number_id: "p1",
    contact_number: "+15550104477",
    last_message_at: "2026-07-25T11:58:00Z",
    last_message_text: "Sounds good, see you then",
    unread_count: 0,
    created_at: "2026-07-01T00:00:00Z",
    phone_numbers: {
      id: "p1",
      label: "Ridgeline",
      phone_number: "+18326501126",
      color: "#3b82f6",
      is_active: true,
    },
    ...overrides,
  }
}

describe("formatConversationRow", () => {
  it("shows the contact number and the brand line", () => {
    const v = formatConversationRow(conv(), NOW)
    expect(v.title).toBe("+15550104477")
    expect(v.lineLabel).toBe("Ridgeline")
    expect(v.lineColor).toBe("#3b82f6")
  })

  it("truncates a long preview to fit the narrow panel", () => {
    const v = formatConversationRow(
      conv({ last_message_text: "x".repeat(80) }),
      NOW
    )
    expect(v.preview.length).toBeLessThanOrEqual(41) // 40 chars + ellipsis
    expect(v.preview.endsWith("…")).toBe(true)
  })

  it("does not truncate a short preview or add an ellipsis", () => {
    const v = formatConversationRow(conv({ last_message_text: "Short" }), NOW)
    expect(v.preview).toBe("Short")
  })

  it("falls back to a placeholder when there is no message text", () => {
    expect(
      formatConversationRow(conv({ last_message_text: null }), NOW).preview
    ).toBe("No messages yet")
  })

  it("marks a conversation unread when unread_count is positive", () => {
    expect(formatConversationRow(conv({ unread_count: 3 }), NOW).unread).toBe(true)
    expect(formatConversationRow(conv({ unread_count: 0 }), NOW).unread).toBe(false)
  })

  it("uses compact relative times", () => {
    expect(formatConversationRow(conv(), NOW).timeText).toBe("2m")
    expect(
      formatConversationRow(
        conv({ last_message_at: "2026-07-25T09:00:00Z" }),
        NOW
      ).timeText
    ).toBe("3h")
  })

  it("shows a weekday inside the last week", () => {
    const v = formatConversationRow(
      conv({ last_message_at: "2026-07-22T09:00:00Z" }),
      NOW
    )
    expect(v.timeText).toMatch(/^[A-Z][a-z]{2}$/)
  })

  it("shows a short date beyond a week", () => {
    const v = formatConversationRow(
      conv({ last_message_at: "2026-06-02T09:00:00Z" }),
      NOW
    )
    expect(v.timeText).toMatch(/Jun/)
  })

  it("survives a conversation with no joined line and no timestamp", () => {
    const v = formatConversationRow(
      conv({ phone_numbers: undefined, last_message_at: null }),
      NOW
    )
    expect(v.lineLabel).toBeNull()
    expect(v.lineColor).toBeNull()
    expect(v.timeText).toBe("")
  })
})
