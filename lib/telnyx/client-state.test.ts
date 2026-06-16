import { describe, it, expect } from "vitest"
import { encodeClientState, decodeClientState } from "./client-state"

describe("client-state codec", () => {
  it("round-trips an agent-leg payload", () => {
    const encoded = encodeClientState({ role: "agent", aLegId: "abc-123", callId: "db-1" })
    expect(typeof encoded).toBe("string")
    expect(decodeClientState(encoded)).toEqual({
      role: "agent",
      aLegId: "abc-123",
      callId: "db-1",
    })
  })

  it("returns null for undefined / garbage input", () => {
    expect(decodeClientState(undefined)).toBeNull()
    expect(decodeClientState("not-base64-json!!")).toBeNull()
  })
})
