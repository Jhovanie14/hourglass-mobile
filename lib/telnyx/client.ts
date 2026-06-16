import Telnyx from "telnyx"

let cached: Telnyx | null = null

/** Single server-only Telnyx client. Never import into client components. */
export function getTelnyxClient(): Telnyx {
  if (!cached) {
    const apiKey = process.env.TELNYX_API_KEY
    if (!apiKey) throw new Error("TELNYX_API_KEY is not set")
    cached = new Telnyx({ apiKey })
  }
  return cached
}

/**
 * Retry a Telnyx command on rate-limit (429) / transient 5xx with exponential
 * backoff. Telnyx command calls are idempotent when given the same command_id,
 * so retries are safe.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      const status = (err as { statusCode?: number })?.statusCode
      const retryable = status === 429 || (typeof status === "number" && status >= 500)
      if (!retryable || i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 250 * 2 ** i))
    }
  }
  throw lastErr
}
