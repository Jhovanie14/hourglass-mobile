import crypto from "node:crypto"

export function signJadesPayload(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  return `sha256=${digest}`
}

export function verifyJadesSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = signJadesPayload(secret, timestamp, rawBody)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
