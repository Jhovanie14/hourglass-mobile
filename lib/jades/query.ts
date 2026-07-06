export type EventsQuery = { since: string; limit: number }
export type EventsQueryResult =
  | { ok: true; value: EventsQuery }
  | { ok: false; error: string }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function parseEventsQuery(params: URLSearchParams): EventsQueryResult {
  const since = params.get("since")
  if (!since) return { ok: false, error: "missing 'since' query param" }
  const parsed = Date.parse(since)
  if (Number.isNaN(parsed)) return { ok: false, error: "'since' must be an ISO 8601 timestamp" }

  let limit = DEFAULT_LIMIT
  const limitRaw = params.get("limit")
  if (limitRaw !== null) {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "'limit' must be a positive integer" }
    limit = Math.min(n, MAX_LIMIT)
  }
  return { ok: true, value: { since: new Date(parsed).toISOString(), limit } }
}
