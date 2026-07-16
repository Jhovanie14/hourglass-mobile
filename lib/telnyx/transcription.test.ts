import { describe, expect, it } from "vitest"
import {
  isTranscriptionEnabled,
  speakerForTrack,
  segmentFromEvent,
} from "./transcription"

describe("isTranscriptionEnabled", () => {
  it("is on when the env var is unset", () => {
    expect(isTranscriptionEnabled({})).toBe(true)
  })
  it("is on for any value other than the string false", () => {
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "true" })).toBe(true)
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "" })).toBe(true)
  })
  it("is off only for the exact string false", () => {
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "false" })).toBe(false)
  })
})

describe("speakerForTrack", () => {
  it("maps the inbound call's inbound track to the contact (caller speaks)", () => {
    expect(speakerForTrack("inbound", "inbound")).toBe("contact")
  })
  it("maps the inbound call's outbound track to the agent", () => {
    expect(speakerForTrack("inbound", "outbound")).toBe("agent")
  })
  it("maps the outbound call's inbound track to the agent (agent speaks)", () => {
    expect(speakerForTrack("outbound", "inbound")).toBe("agent")
  })
  it("maps the outbound call's outbound track to the contact", () => {
    expect(speakerForTrack("outbound", "outbound")).toBe("contact")
  })
  it("returns null when the track is missing or unknown", () => {
    expect(speakerForTrack("inbound", undefined)).toBe(null)
    expect(speakerForTrack("outbound", "weird")).toBe(null)
  })
})

describe("segmentFromEvent", () => {
  const occurredAt = "2026-07-17T12:00:00.000Z"

  it("normalizes a final caller segment on an inbound call", () => {
    expect(
      segmentFromEvent(
        "inbound",
        {
          transcript: "Hello, I need help",
          confidence: 0.92,
          is_final: true,
          transcription_track: "inbound",
        },
        occurredAt
      )
    ).toEqual({
      speaker: "contact",
      transcript: "Hello, I need help",
      confidence: 0.92,
      occurred_at: occurredAt,
    })
  })

  it("flips attribution for outbound calls", () => {
    const row = segmentFromEvent(
      "outbound",
      { transcript: "Hi, this is Ellen Marketing", is_final: true, transcription_track: "inbound" },
      occurredAt
    )
    expect(row?.speaker).toBe("agent")
  })

  it("drops interim results", () => {
    expect(
      segmentFromEvent("inbound", { transcript: "partial", is_final: false }, occurredAt)
    ).toBe(null)
  })

  it("drops empty and whitespace-only transcripts", () => {
    expect(segmentFromEvent("inbound", { transcript: "", is_final: true }, occurredAt)).toBe(null)
    expect(segmentFromEvent("inbound", { transcript: "   ", is_final: true }, occurredAt)).toBe(null)
    expect(segmentFromEvent("inbound", undefined, occurredAt)).toBe(null)
  })

  it("treats a missing is_final as final (final-only engines omit it)", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello" }, occurredAt)
    expect(row?.transcript).toBe("hello")
  })

  it("stores null speaker and confidence when absent", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello", is_final: true }, occurredAt)
    expect(row?.speaker).toBe(null)
    expect(row?.confidence).toBe(null)
  })

  it("falls back to now when occurred_at is missing", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello" }, undefined)
    expect(typeof row?.occurred_at).toBe("string")
    expect(Number.isNaN(Date.parse(row!.occurred_at))).toBe(false)
  })
})
