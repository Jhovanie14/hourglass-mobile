import crypto from "node:crypto"

const PREFIX = "Bearer "

export function isValidBearer(authHeader: string | null, token: string): boolean {
  if (!authHeader || !token) return false
  if (!authHeader.startsWith(PREFIX)) return false
  const provided = authHeader.slice(PREFIX.length)
  const a = Buffer.from(provided)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
