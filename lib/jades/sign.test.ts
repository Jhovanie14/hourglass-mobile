import { describe, expect, it } from "vitest"
import { signJadesPayload, verifyJadesSignature } from "./sign"

describe("jades signing", () => {
  const secret = "shhh"
  const ts = "1751900000"
  const body = '{"event_id":"abc"}'

  it("produces a sha256= prefixed hex signature", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it("verifies a matching signature", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature(secret, ts, body, sig)).toBe(true)
  })

  it("rejects a tampered body", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature(secret, ts, '{"event_id":"XXX"}', sig)).toBe(false)
  })

  it("rejects a wrong secret", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature("other", ts, body, sig)).toBe(false)
  })
})
