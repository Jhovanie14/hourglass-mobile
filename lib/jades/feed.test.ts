import { describe, expect, it } from "vitest"
import {
  callToFeedEvent,
  mergeFeedEvents,
  messageToFeedEvent,
  voicemailToFeedEvent,
  type JadesFeedEvent,
} from "./feed"

const phone = { label: "STR", phone_number: "+18325550100" }

describe("callToFeedEvent", () => {
  it("maps an inbound missed call (external=from, our line=to)", () => {
    expect(callToFeedEvent({
      contact_number: "+18325559999", direction: "inbound", status: "missed",
      duration_seconds: 0, started_at: "2026-07-06T21:00:00.000Z", created_at: "2026-07-06T21:00:00.000Z", phone,
    })).toEqual({
      type: "call", direction: "inbound", from: "+18325559999", to: "+18325550100",
      phone_label: "STR", timestamp: "2026-07-06T21:00:00.000Z", duration_sec: 0,
      transcript: null, body: null, status: "missed",
    })
  })

  it("maps an outbound answered call (our line=from, external=to)", () => {
    const e = callToFeedEvent({
      contact_number: "+18325559999", direction: "outbound", status: "completed",
      duration_seconds: 120, started_at: "2026-07-06T21:05:00.000Z", created_at: "2026-07-06T21:05:00.000Z", phone,
    })
    expect(e.from).toBe("+18325550100")
    expect(e.to).toBe("+18325559999")
    expect(e.status).toBe("answered")
    expect(e.duration_sec).toBe(120)
  })
})

describe("messageToFeedEvent", () => {
  it("maps an inbound sms as received", () => {
    expect(messageToFeedEvent({
      direction: "inbound", body: "Is it available?", sent_at: "2026-07-06T21:10:00.000Z",
      created_at: "2026-07-06T21:10:00.000Z", contact_number: "+18325559999", phone,
    })).toEqual({
      type: "sms", direction: "inbound", from: "+18325559999", to: "+18325550100",
      phone_label: "STR", timestamp: "2026-07-06T21:10:00.000Z", duration_sec: null,
      transcript: null, body: "Is it available?", status: "received",
    })
  })

  it("maps an outbound sms as sent, reversing from/to", () => {
    const e = messageToFeedEvent({
      direction: "outbound", body: "Yes!", sent_at: "2026-07-06T21:11:00.000Z",
      created_at: "2026-07-06T21:11:00.000Z", contact_number: "+18325559999", phone,
    })
    expect(e.from).toBe("+18325550100")
    expect(e.to).toBe("+18325559999")
    expect(e.status).toBe("sent")
  })
})

describe("voicemailToFeedEvent", () => {
  it("maps a voicemail with audio_url and null transcript", () => {
    expect(voicemailToFeedEvent({
      recording_url: "https://x/v.mp3", duration_seconds: 42, created_at: "2026-07-06T21:12:00.000Z",
      contact_number: "+18325559999", phone,
    })).toEqual({
      type: "voicemail", direction: "inbound", from: "+18325559999", to: "+18325550100",
      phone_label: "STR", timestamp: "2026-07-06T21:12:00.000Z", duration_sec: 42,
      transcript: null, body: null, status: null, audio_url: "https://x/v.mp3",
    })
  })
})

describe("mergeFeedEvents", () => {
  it("sorts oldest→newest and caps to limit", () => {
    const mk = (ts: string): JadesFeedEvent => ({
      type: "call", direction: "inbound", from: "a", to: "b", phone_label: "STR",
      timestamp: ts, duration_sec: 0, transcript: null, body: null, status: "missed",
    })
    const merged = mergeFeedEvents([mk("2026-07-06T03:00:00Z"), mk("2026-07-06T01:00:00Z"), mk("2026-07-06T02:00:00Z")], 2)
    expect(merged.map((e) => e.timestamp)).toEqual(["2026-07-06T01:00:00Z", "2026-07-06T02:00:00Z"])
  })
})
