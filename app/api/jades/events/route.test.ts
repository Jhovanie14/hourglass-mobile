import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Notifications the mocked Supabase chain returns, ordered by created_at asc.
const notifRows = [
  { id: "n1", type: "missed_call", reference_id: "c1", metadata: {}, is_read: false, created_at: "2026-07-07T00:00:01.000Z" },
]

// Supabase query chain: from().select().gt().in().order().order().limit()
vi.mock("@/lib/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        gt: () => ({
          in: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({ data: notifRows, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

const loadJadesEvent = vi.fn()
vi.mock("@/lib/jades/load-event", () => ({ loadJadesEvent: (...a: unknown[]) => loadJadesEvent(...a) }))
vi.mock("@/lib/jades/supabase-source", () => ({ supabaseDataSource: vi.fn(() => ({})) }))

import { GET } from "./route"

beforeEach(() => {
  process.env.JADES_API_TOKEN = "tok"
  loadJadesEvent.mockResolvedValue({
    event_id: "n1", type: "missed_call", occurred_at: notifRows[0].created_at,
    property: "x", property_line: "+1", data: {},
  })
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
    const res = await GET(req("https://x/api/jades/events?since=2026-07-07T00:00:00Z", "Bearer nope"))
    expect(res.status).toBe(401)
  })
  it("400 when since is missing", async () => {
    const res = await GET(req("https://x/api/jades/events", "Bearer tok"))
    expect(res.status).toBe(400)
  })
  it("200 with events + next_since", async () => {
    const res = await GET(req("https://x/api/jades/events?since=2026-07-07T00:00:00Z", "Bearer tok"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.next_since).toBe("2026-07-07T00:00:01.000Z")
  })
})
