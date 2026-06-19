import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted above imports, so the spies it references must come from
// vi.hoisted (also hoisted) — a plain `const dial = vi.fn()` would be in the
// temporal dead zone when the factory runs.
const { dial, hangup } = vi.hoisted(() => ({ dial: vi.fn(), hangup: vi.fn() }))
vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { hangup } } }),
  withRetry: (fn: () => unknown) => fn(),
}))

import { dialAgentLeg, hangupLeg } from "./voice-orchestrator"
import { decodeClientState } from "./client-state"

beforeEach(() => {
  dial.mockReset()
  hangup.mockReset()
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
