import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getRequestUserId: vi.fn() }))

const upsert = vi.fn().mockResolvedValue({ error: null })
const eqChain = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }))
const del = vi.fn(() => ({ eq: eqChain }))
vi.mock("@/lib/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn(() => ({ upsert, delete: del })),
  })),
}))

import { POST, DELETE } from "./route"
import { getRequestUserId } from "@/lib/auth"

function jsonRequest(method: string, body: unknown) {
  return new Request("http://test/api/devices/register", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/devices/register", () => {
  beforeEach(() => vi.clearAllMocks())

  it("POST 401s without auth", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue(null)
    expect((await POST(jsonRequest("POST", { token: "t" }))).status).toBe(401)
  })

  it("POST 400s without a token", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    expect((await POST(jsonRequest("POST", {}))).status).toBe(400)
  })

  it("POST upserts the caller's token", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await POST(jsonRequest("POST", { token: "fcm-abc", platform: "android" }))
    expect(res.status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        fcm_token: "fcm-abc",
        platform: "android",
      }),
      { onConflict: "fcm_token" }
    )
  })

  it("DELETE removes the caller's token", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await DELETE(jsonRequest("DELETE", { token: "fcm-abc" }))
    expect(res.status).toBe(200)
    expect(del).toHaveBeenCalled()
  })
})
