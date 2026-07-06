import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/admin"
import { isValidBearer } from "@/lib/jades/auth"
import { getJadesConfig } from "@/lib/jades/config"
import { fetchFeedEvents } from "@/lib/jades/feed-source"
import { parseEventsQuery } from "@/lib/jades/query"

/**
 * GET /api/jades/events?since=<ISO8601>&limit=<n>
 *
 * Returns inbound + outbound calls, SMS, and voicemails created after `since`,
 * in Jades' flat feed shape, plus `latest_timestamp` for the next poll cursor.
 * Bearer-authenticated with JADES_API_TOKEN.
 */
export async function GET(req: Request): Promise<Response> {
  const config = getJadesConfig()
  if (!config.apiToken) {
    return NextResponse.json({ error: "integration not configured" }, { status: 503 })
  }
  if (!isValidBearer(req.headers.get("authorization"), config.apiToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const parsed = parseEventsQuery(new URL(req.url).searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { since, limit } = parsed.value

  let events
  try {
    events = await fetchFeedEvents(createAdminClient(), since, limit)
  } catch (err) {
    console.error("Jades feed query failed:", err)
    return NextResponse.json({ error: "query failed" }, { status: 500 })
  }

  const latestTimestamp = events.length > 0 ? events[events.length - 1].timestamp : since
  return NextResponse.json({ events, latest_timestamp: latestTimestamp })
}
