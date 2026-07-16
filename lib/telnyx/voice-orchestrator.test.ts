import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted above imports, so the spies it references must come from
// vi.hoisted (also hoisted) — a plain `const dial = vi.fn()` would be in the
// temporal dead zone when the factory runs.
const { dial, hangup, startTranscription } = vi.hoisted(() => ({
  dial: vi.fn(),
  hangup: vi.fn(),
  startTranscription: vi.fn(),
}))
vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { hangup, startTranscription } } }),
  withRetry: (fn: () => unknown) => fn(),
}))

import { dialAgentLeg, hangupLeg, startCallTranscription } from "./voice-orchestrator"
import { decodeClientState } from "./client-state"

beforeEach(() => {
  dial.mockReset()
  hangup.mockReset()
  startTranscription.mockReset()
  process.env.TELNYX_VOICE_APP_ID = "app-1"
})

describe("dialAgentLeg", () => {
  it("dials the agent's own SIP username and returns the new leg id", async () => {
    dial.mockResolvedValue({ data: { call_control_id: "b-leg-1" } })

    const legId = await dialAgentLeg({
      aLegId: "a-1",
      callId: "call-1",
      didNumber: "+18326501126",
      callerNumber: "+15551234567",
      sipUsername: "gencredXYZ",
      userId: "user-1",
    })

    expect(legId).toBe("b-leg-1")
    const arg = dial.mock.calls[0][0]
    expect(arg.to).toBe("sip:gencredXYZ@sip.telnyx.com")
    expect(arg.from).toBe("+18326501126")
    expect(arg.connection_id).toBe("app-1")
    expect(decodeClientState(arg.client_state)).toEqual({
      role: "agent",
      aLegId: "a-1",
      callId: "call-1",
      userId: "user-1",
    })
  })
})

describe("hangupLeg", () => {
  it("hangs up the given call_control_id", async () => {
    hangup.mockResolvedValue({})
    await hangupLeg("b-leg-9")
    expect(hangup).toHaveBeenCalledWith("b-leg-9", expect.objectContaining({}))
  })
})

describe("startCallTranscription", () => {
  it("starts Telnyx-engine transcription of both tracks on the given leg", async () => {
    startTranscription.mockResolvedValue({})

    await startCallTranscription("a-leg-9")

    expect(startTranscription).toHaveBeenCalledTimes(1)
    const [legId, body] = startTranscription.mock.calls[0]
    expect(legId).toBe("a-leg-9")
    expect(body.transcription_engine).toBe("Telnyx")
    expect(body.transcription_tracks).toBe("both")
    expect(body.transcription_engine_config).toMatchObject({
      transcription_engine: "Telnyx",
      language: "en",
      transcription_model: "openai/whisper-large-v3-turbo",
    })
    expect(typeof body.command_id).toBe("string")
  })
})
