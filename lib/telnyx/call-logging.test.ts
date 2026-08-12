import { describe, it, expect, vi } from "vitest"
import {
  computeFinalStatus,
  markOutboundAnswered,
  finalizeCall,
  answeredAction,
} from "./call-logging"

// Minimal chainable Supabase-admin mock for `calls` UPDATE ... eq(telnyx_call_id).
// Captures the update payload + the eq filter so tests can assert what was written.
function makeAdmin(updateErr: unknown = null) {
  const eq = vi.fn().mockResolvedValue({ error: updateErr })
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { admin: { from } as never, from, update, eq }
}

describe("computeFinalStatus", () => {
  it("maps an answered call to completed", () => {
    expect(computeFinalStatus("answered", "outbound")).toBe("completed")
    expect(computeFinalStatus("answered", "inbound")).toBe("completed")
  })

  it("keeps an already-completed call completed", () => {
    expect(computeFinalStatus("completed", "outbound")).toBe("completed")
  })

  it("keeps a voicemail call as voicemail", () => {
    expect(computeFinalStatus("voicemail", "inbound")).toBe("voicemail")
  })

  it("maps an unanswered inbound call to missed", () => {
    expect(computeFinalStatus("ringing", "inbound")).toBe("missed")
    expect(computeFinalStatus("initiated", "inbound")).toBe("missed")
  })

  it("maps an unanswered outbound call to failed", () => {
    expect(computeFinalStatus("initiated", "outbound")).toBe("failed")
  })
})

describe("answeredAction", () => {
  // call.answered payloads carry NO direction, so the action must be decided
  // from the stored call row, not the webhook payload.
  it("marks an outbound call answered (regardless of status)", () => {
    expect(answeredAction({ direction: "outbound", status: "initiated" })).toBe(
      "mark_outbound_answered"
    )
  })

  it("bridges when an inbound call already has a winning agent (answered)", () => {
    expect(answeredAction({ direction: "inbound", status: "answered" })).toBe(
      "bridge"
    )
  })

  it("plays voicemail when an inbound call is in voicemail state", () => {
    expect(answeredAction({ direction: "inbound", status: "voicemail" })).toBe(
      "voicemail"
    )
  })

  it("does nothing for an inbound call still ringing", () => {
    expect(answeredAction({ direction: "inbound", status: "ringing" })).toBe(
      "noop"
    )
  })
})

describe("answeredAction — AI-handled calls", () => {
  it("starts the AI on a ringing inbound AI call", () => {
    expect(
      answeredAction({ direction: "inbound", status: "ringing", aiHandled: true })
    ).toBe("start_ai")
  })

  it("noops on any non-ringing AI call (duplicate answered events)", () => {
    expect(
      answeredAction({ direction: "inbound", status: "answered", aiHandled: true })
    ).toBe("noop")
    expect(
      answeredAction({ direction: "inbound", status: "voicemail", aiHandled: true })
    ).toBe("noop")
  })

  it("keeps outbound and non-AI behavior unchanged", () => {
    expect(
      answeredAction({ direction: "outbound", status: "initiated", aiHandled: true })
    ).toBe("mark_outbound_answered")
    expect(
      answeredAction({ direction: "inbound", status: "voicemail", aiHandled: false })
    ).toBe("voicemail")
  })
})

describe("markOutboundAnswered", () => {
  it("sets status=answered and started_at for the matching call", async () => {
    const m = makeAdmin()
    const now = new Date("2026-06-24T10:00:00.000Z")

    await markOutboundAnswered(m.admin, "cc-123", now)

    expect(m.from).toHaveBeenCalledWith("calls")
    expect(m.update).toHaveBeenCalledWith({
      status: "answered",
      started_at: now.toISOString(),
    })
    expect(m.eq).toHaveBeenCalledWith("telnyx_call_id", "cc-123")
  })
})

describe("finalizeCall", () => {
  it("finalizes an answered outbound call as completed with duration", async () => {
    const m = makeAdmin()
    const status = await finalizeCall(m.admin, {
      telnyxCallId: "cc-1",
      prevStatus: "answered",
      direction: "outbound",
      startedAt: "2026-06-24T10:00:00.000Z",
      endedAt: "2026-06-24T10:00:30.000Z",
    })

    expect(status).toBe("completed")
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        ended_at: "2026-06-24T10:00:30.000Z",
        duration_seconds: 30,
      })
    )
    expect(m.eq).toHaveBeenCalledWith("telnyx_call_id", "cc-1")
  })

  it("finalizes an unanswered outbound call as failed without duration", async () => {
    const m = makeAdmin()
    const status = await finalizeCall(m.admin, {
      telnyxCallId: "cc-2",
      prevStatus: "initiated",
      direction: "outbound",
      startedAt: null,
      endedAt: "2026-06-24T10:00:30.000Z",
    })

    expect(status).toBe("failed")
    expect(m.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ duration_seconds: expect.anything() })
    )
  })

  it("finalizes an unanswered inbound call as missed", async () => {
    const m = makeAdmin()
    const status = await finalizeCall(m.admin, {
      telnyxCallId: "cc-3",
      prevStatus: "ringing",
      direction: "inbound",
      startedAt: null,
      endedAt: "2026-06-24T10:00:30.000Z",
    })
    expect(status).toBe("missed")
  })
})
