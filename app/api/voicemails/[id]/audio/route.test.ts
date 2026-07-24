import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getRequestUserId: vi.fn() }))

const maybeSingle = vi.fn()
const createSignedUrl = vi.fn()
vi.mock("@/lib/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })),
    })),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  })),
}))

import { GET } from "./route"
import { getRequestUserId } from "@/lib/auth"

const params = Promise.resolve({ id: "vm-1" })

/**
 * A request the way the mobile app sends it: a Bearer token and no cookies.
 * This is the case the route originally got wrong — it authenticated with the
 * cookie-only getCurrentUser(), so every mobile request 401'd.
 */
function bearerRequest(url = "http://test/api/voicemails/vm-1/audio?format=json") {
  return new Request(url, { headers: { authorization: "Bearer fake-access-token" } })
}

describe("/api/voicemails/[id]/audio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockResolvedValue({ data: { storage_path: "vm-1.mp3", recording_url: null } })
    createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.example/vm-1.mp3?token=abc" },
      error: null,
    })
  })

  it("401s when the request carries no usable credentials", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue(null)
    const res = await GET(bearerRequest(), { params })
    expect(res.status).toBe(401)
  })

  it("authenticates a Bearer token — the mobile app sends no cookies", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await GET(bearerRequest(), { params })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe("https://storage.example/vm-1.mp3?token=abc")
  })

  it("signs a 10-minute URL for format=json, not the browser's 60s", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    await GET(bearerRequest(), { params })
    expect(createSignedUrl).toHaveBeenCalledWith("vm-1.mp3", 600)
  })

  it("still redirects with a 60s URL when format=json is absent", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await GET(bearerRequest("http://test/api/voicemails/vm-1/audio"), { params })
    expect(createSignedUrl).toHaveBeenCalledWith("vm-1.mp3", 60)
    expect(res.status).toBe(307)
  })

  it("returns the non-expiring Telnyx URL when there is no stored object", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    maybeSingle.mockResolvedValue({
      data: { storage_path: null, recording_url: "https://telnyx.example/rec.mp3" },
    })
    const res = await GET(bearerRequest(), { params })
    const body = await res.json()
    expect(body).toEqual({ url: "https://telnyx.example/rec.mp3", expiresAt: null })
  })

  it("404s when the voicemail row is missing", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    maybeSingle.mockResolvedValue({ data: null })
    const res = await GET(bearerRequest(), { params })
    expect(res.status).toBe(404)
  })
})
