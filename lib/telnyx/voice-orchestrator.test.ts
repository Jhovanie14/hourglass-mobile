import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted; use vi.hoisted so the spies exist when the factory runs.
const { dial, bridge, hangup } = vi.hoisted(() => ({ dial: vi.fn(), bridge: vi.fn(), hangup: vi.fn() }))

vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { bridge, hangup } } }),
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

import { dialAgent, bridgeLegs, hangupCall } from "./voice-orchestrator"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELNYX_SIP_USERNAME = "agent-sip-user"
  process.env.TELNYX_VOICE_APP_ID = "app-123"
})

describe("dialAgent", () => {
  const params = {
    aLegId: "caller-leg-1",
    callId: "db-1",
    didNumber: "+18326501126",
    callerNumber: "+15551234567",
  }

  it("returns the dialed agent leg's call_control_id", async () => {
    dial.mockResolvedValue({ data: { call_control_id: "agent-leg-xyz" } })
    const id = await dialAgent(params)
    expect(id).toBe("agent-leg-xyz")
  })

  it("throws if the dial response has no call_control_id", async () => {
    dial.mockResolvedValue({ data: {} })
    await expect(dialAgent(params)).rejects.toThrow(/call_control_id/)
  })
})

describe("bridgeLegs", () => {
  it("sends play_ringtone when requested", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz", { playRingtone: true })
    expect(bridge).toHaveBeenCalledWith(
      "caller-leg-1",
      expect.objectContaining({
        call_control_id_to_bridge_with: "agent-leg-xyz",
        play_ringtone: true,
      })
    )
  })

  it("omits play_ringtone by default", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz")
    expect(bridge.mock.calls[0][1]).not.toHaveProperty("play_ringtone")
  })

  it("sends park_after_unbridge 'self' when parkAfterUnbridge is requested", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz", { parkAfterUnbridge: true })
    expect(bridge).toHaveBeenCalledWith(
      "caller-leg-1",
      expect.objectContaining({ park_after_unbridge: "self" })
    )
  })

  it("omits park_after_unbridge by default", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz")
    expect(bridge.mock.calls[0][1]).not.toHaveProperty("park_after_unbridge")
  })
})

describe("hangupCall", () => {
  it("hangs up the given leg with a command_id", async () => {
    hangup.mockResolvedValue({})
    await hangupCall("leg-1")
    expect(hangup).toHaveBeenCalledWith(
      "leg-1",
      expect.objectContaining({ command_id: expect.any(String) })
    )
  })
})
