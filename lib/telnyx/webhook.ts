import crypto from "crypto"

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const MAX_SKEW_SECONDS = 300 // reject timestamps more than ±5 min from now

type VerifyArgs = {
  body: string
  signature: string | null
  timestamp: string | null
  publicKeyBase64: string | undefined
}

export function verifyTelnyxWebhook({
  body,
  signature,
  timestamp,
  publicKeyBase64,
}: VerifyArgs): boolean {
  if (!signature || !timestamp || !publicKeyBase64) return false // fail closed

  // Replay protection: timestamp must be recent.
  const tsSeconds = Number(timestamp)
  if (!Number.isFinite(tsSeconds)) return false
  const nowSeconds = Date.now() / 1000
  if (Math.abs(nowSeconds - tsSeconds) > MAX_SKEW_SECONDS) return false

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    })
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${body}`),
      publicKey,
      Buffer.from(signature, "base64")
    )
  } catch {
    return false
  }
}
