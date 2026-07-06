import { describe, expect, it, vi } from "vitest"
import type { Notification } from "@/types/notifications"
import type { EventDataSource } from "./load-event"
import { loadJadesEvent } from "./load-event"

const meta = { contact_number: "+1", phone_label: "x" }
const phone = { label: "Fontana Dallas", phone_number: "+19725550101" }

function source(overrides: Partial<EventDataSource> = {}): EventDataSource {
  return {
    getCall: vi.fn().mockResolvedValue({ id: "call1", contact_number: "+12145551234", duration_seconds: 0, started_at: null, phone }),
    getVoicemailByCall: vi.fn().mockResolvedValue({ id: "vm1", recording_url: "https://x/r.mp3", duration_seconds: 12 }),
    getConversation: vi.fn().mockResolvedValue({ id: "conv1", contact_number: "+12145551234", phone }),
    getLatestInboundMessage: vi.fn().mockResolvedValue({ id: "msg1", body: "hi", media_urls: null }),
    ...overrides,
  }
}

const n = (over: Partial<Notification>): Notification => ({
  id: "n", type: "missed_call", reference_id: "call1", metadata: meta, is_read: false, created_at: "2026-07-07T00:00:00.000Z", ...over,
})

describe("loadJadesEvent", () => {
  it("loads a missed_call", async () => {
    const e = await loadJadesEvent(source(), n({ type: "missed_call", reference_id: "call1" }))
    expect(e?.type).toBe("missed_call")
  })
  it("loads a voicemail (call + voicemail)", async () => {
    const e = await loadJadesEvent(source(), n({ type: "voicemail", reference_id: "call2" }))
    expect(e?.type).toBe("voicemail")
  })
  it("maps unread_message to new_sms", async () => {
    const e = await loadJadesEvent(source(), n({ type: "unread_message", reference_id: "conv1" }))
    expect(e?.type).toBe("new_sms")
  })
  it("returns null when the joined row is missing", async () => {
    const e = await loadJadesEvent(source({ getCall: vi.fn().mockResolvedValue(null) }), n({ type: "missed_call" }))
    expect(e).toBeNull()
  })
})
