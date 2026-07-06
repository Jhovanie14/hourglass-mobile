import { describe, expect, it } from "vitest"
import type { Notification } from "@/types/notifications"
import { buildMissedCallEvent, buildVoicemailEvent, buildSmsEvent } from "./payload"

const base = { is_read: false, metadata: { contact_number: "+1", phone_label: "x" } }

const missedNotif: Notification = {
  ...base, id: "n1", type: "missed_call", reference_id: "call1", created_at: "2026-07-07T18:42:05.000Z",
}
const vmNotif: Notification = {
  ...base, id: "n2", type: "voicemail", reference_id: "call2", created_at: "2026-07-07T18:43:00.000Z",
}
const smsNotif: Notification = {
  ...base, id: "n3", type: "unread_message", reference_id: "conv1", is_read: true, created_at: "2026-07-07T18:44:00.000Z",
}

describe("payload builders", () => {
  it("builds a missed_call event", () => {
    expect(buildMissedCallEvent(missedNotif, {
      id: "call1", contact_number: "+12145551234", duration_seconds: 0, started_at: "2026-07-07T18:42:00.000Z",
      phone: { label: "Fontana Dallas", phone_number: "+19725550101" },
    })).toEqual({
      event_id: "n1", type: "missed_call", occurred_at: "2026-07-07T18:42:05.000Z",
      property: "Fontana Dallas", property_line: "+19725550101",
      data: { caller_number: "+12145551234", caller_name: null, duration_seconds: 0, started_at: "2026-07-07T18:42:00.000Z", call_id: "call1" },
    })
  })

  it("builds a voicemail event with null transcription", () => {
    const e = buildVoicemailEvent(vmNotif,
      { id: "call2", contact_number: "+12145551234", duration_seconds: 30, started_at: null, phone: { label: "Woodvalley Houston", phone_number: "+17135550102" } },
      { id: "vm1", recording_url: "https://x/rec.mp3", duration_seconds: 42 })
    expect(e).toEqual({
      event_id: "n2", type: "voicemail", occurred_at: "2026-07-07T18:43:00.000Z",
      property: "Woodvalley Houston", property_line: "+17135550102",
      data: { caller_number: "+12145551234", caller_name: null, audio_url: "https://x/rec.mp3", transcription: null, duration_seconds: 42, voicemail_id: "vm1", call_id: "call2" },
    })
  })

  it("builds a new_sms event, mapping unread_message and is_read", () => {
    const e = buildSmsEvent(smsNotif,
      { id: "conv1", contact_number: "+12145551234", phone: { label: "Fontana Dallas", phone_number: "+19725550101" } },
      { id: "msg1", body: "Is the unit available?", media_urls: null })
    expect(e).toEqual({
      event_id: "n3", type: "new_sms", occurred_at: "2026-07-07T18:44:00.000Z",
      property: "Fontana Dallas", property_line: "+19725550101",
      data: { from_number: "+12145551234", to_number: "+19725550101", body: "Is the unit available?", media_urls: [], read: true, message_id: "msg1", conversation_id: "conv1" },
    })
  })
})
