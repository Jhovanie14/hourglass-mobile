import { describe, it, expect } from "vitest"
import crypto from "crypto"
import { verifyTelnyxWebhook } from "./webhook"

// Telnyx signs `${timestamp}|${body}` with Ed25519; the public key is sent
// base64 (raw 32 bytes). Build a matching keypair for the test.
function makeSigned(body: string, timestamp: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const sig = crypto.sign(null, Buffer.from(`${timestamp}|${body}`), privateKey)
  const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
  return {
    signature: sig.toString("base64"),
    publicKeyBase64: rawPub.toString("base64"),
  }
}

describe("verifyTelnyxWebhook", () => {
  const body = '{"hello":"world"}'

  it("accepts a valid, fresh signature", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { signature, publicKeyBase64 } = makeSigned(body, ts)
    expect(verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64 })).toBe(true)
  })

  it("rejects a stale timestamp (replay)", () => {
    const ts = (Math.floor(Date.now() / 1000) - 600).toString() // 10 min old
    const { signature, publicKeyBase64 } = makeSigned(body, ts)
    expect(verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64 })).toBe(false)
  })

  it("rejects a bad signature", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { publicKeyBase64 } = makeSigned(body, ts)
    expect(
      verifyTelnyxWebhook({ body, signature: "AAAA", timestamp: ts, publicKeyBase64 })
    ).toBe(false)
  })

  it("rejects when public key is missing (fail closed)", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { signature } = makeSigned(body, ts)
    expect(
      verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64: undefined })
    ).toBe(false)
  })
})
