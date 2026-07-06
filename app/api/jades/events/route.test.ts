import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { JadesFeedEvent } from "@/lib/jades/feed"

vi.mock("@/lib/admin", () => ({ createAdminClient: () => ({}) }))

const fetchFeedEvents = vi.fn()
vi.mock("@/lib/jades/feed-source", () => ({
  fetchFeedEvents: (...a: unknown[]) => fetchFeedEvents(...a),
}))

import { GET } from "./route"

const sampleEvent: JadesFeedEvent = {
  type: "call", direction: "inbound", from: "+18325559999", to: "+18325550100",
  phone_label: "STR", timestamp: "2026-07-06T21:00:00.000Z", duration_sec: 0,
  transcript: null, body: null, status: "missed",
}

beforeEach(() => {
  process.env.JADES_API_TOKEN = "tok"
  fetchFeedEvents.mockResolvedValue([sampleEvent])
})
afterEach(() => {
  delete process.env.JADES_API_TOKEN
  vi.clearAllMocks()
})

function req(url: string, auth?: string) {
  return new Request(url, { headers: auth ? { authorization: auth } : {} })
}

describe("GET /api/jades/events", () => {
  it("401 without a valid token", async () => {
    const res = await GET(req("https://x/api/jades/events?since=2026-07-06T00:00:00Z", "Bearer nope"))
    expect(res.status).toBe(401)
  })

  it("400 when since is missing", async () => {
    const res = await GET(req("https://x/api/jades/events", "Bearer tok"))
    expect(res.status).toBe(400)
  })

  it("200 with flat events + latest_timestamp", async () => {
    const res = await GET(req("https://x/api/jades/events?since=2026-07-06T00:00:00Z", "Bearer tok"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toEqual([sampleEvent])
    expect(body.latest_timestamp).toBe("2026-07-06T21:00:00.000Z")
  })

  it("returns since as latest_timestamp when there are no events", async () => {
    fetchFeedEvents.mockResolvedValue([])
    const res = await GET(req("https://x/api/jades/events?since=2026-07-06T00:00:00Z", "Bearer tok"))
    const body = await res.json()
    expect(body.events).toEqual([])
    expect(body.latest_timestamp).toBe("2026-07-06T00:00:00.000Z")
  })
})
