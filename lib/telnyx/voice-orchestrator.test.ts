import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted; use vi.hoisted so the spies exist when the factory runs.
const { dial, bridge } = vi.hoisted(() => ({ dial: vi.fn(), bridge: vi.fn() }))

vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { bridge } } }),
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

import { dialAgent, bridgeLegs } from "./voice-orchestrator"

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
})
