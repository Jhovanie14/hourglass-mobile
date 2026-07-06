import { getJadesConfig, isPushConfigured } from "./config"
import type { JadesEvent } from "./payload"
import { signJadesPayload } from "./sign"

export type DeliverOptions = {
  fetchImpl?: typeof fetch
  maxAttempts?: number
  backoffMs?: number[]
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = [1000, 4000]

export async function deliverToJades(
  event: JadesEvent,
  opts: DeliverOptions = {},
): Promise<{ delivered: boolean; attempts: number }> {
  const config = getJadesConfig()
  if (!isPushConfigured(config)) return { delivered: false, attempts: 0 }

  const fetchImpl = opts.fetchImpl ?? fetch
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS

  const rawBody = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signJadesPayload(config.webhookSecret!, timestamp, rawBody)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(config.webhookUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hourglass-Signature": signature,
          "X-Hourglass-Timestamp": timestamp,
        },
        body: rawBody,
      })
      if (res.ok) return { delivered: true, attempts: attempt }
      console.error(`Jades push non-2xx (attempt ${attempt}, event ${event.event_id}): ${res.status}`)
    } catch (err) {
      console.error(`Jades push error (attempt ${attempt}, event ${event.event_id}):`, err)
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1] ?? 0))
    }
  }
  return { delivered: false, attempts: maxAttempts }
}
