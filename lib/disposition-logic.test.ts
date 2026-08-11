import { describe, it, expect } from "vitest"
import {
  OUTCOME_OPTIONS,
  FOLLOW_UP_OPTIONS,
  outcomeLabel,
  shouldPromptForDisposition,
  followUpDate,
} from "./disposition-logic"

describe("disposition-logic", () => {
  it("exposes the four outcomes in order", () => {
    expect(OUTCOME_OPTIONS.map((o) => o.value)).toEqual([
      "answered",
      "no_answer",
      "rejected",
      "spam",
    ])
    expect(OUTCOME_OPTIONS.map((o) => o.label)).toEqual([
      "Answered",
      "No answer",
      "Rejected",
      "Spam",
    ])
  })

  it("exposes the four follow-up presets", () => {
    expect(FOLLOW_UP_OPTIONS.map((o) => o.value)).toEqual([
      "none",
      "tomorrow",
      "in_3_days",
      "next_week",
    ])
  })

  it("labels an outcome", () => {
    expect(outcomeLabel("no_answer")).toBe("No answer")
  })

  it("prompts for outbound always, inbound only when answered", () => {
    expect(shouldPromptForDisposition("outbound", false)).toBe(true)
    expect(shouldPromptForDisposition("inbound", true)).toBe(true)
    expect(shouldPromptForDisposition("inbound", false)).toBe(false)
  })

  it("resolves follow-up presets to N days out at 09:00 local", () => {
    const now = new Date("2026-08-12T15:30:00")
    expect(followUpDate("none", now)).toBeNull()

    const t = followUpDate("tomorrow", now)!
    expect(t.getDate()).toBe(13)
    expect(t.getHours()).toBe(9)
    expect(t.getMinutes()).toBe(0)

    expect(followUpDate("in_3_days", now)!.getDate()).toBe(15)
    expect(followUpDate("next_week", now)!.getDate()).toBe(19)
  })
})
