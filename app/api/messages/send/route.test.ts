import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getRequestUserId: vi.fn() }))
vi.mock("@/lib/admin", () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock("@/lib/messaging", () => ({ sendMessageWithClient: vi.fn() }))

import { POST } from "./route"
import { getRequestUserId } from "@/lib/auth"
import { sendMessageWithClient } from "@/lib/messaging"

function jsonRequest(body: unknown) {
  return new Request("http://test/api/messages/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

const validBody = {
  conversationId: "c1",
  phoneNumberId: "p1",
  to: "+12105551234",
  body: "hello",
}

describe("POST /api/messages/send", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 without a valid bearer token", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue(null)
    const res = await POST(jsonRequest(validBody))
    expect(res.status).toBe(401)
  })

  it("returns 400 when required fields are missing", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await POST(jsonRequest({ to: "+12105551234" }))
    expect(res.status).toBe(400)
  })

  it("returns the message on success", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(sendMessageWithClient).mockResolvedValue({
      ok: true,
      message: { id: "m1" } as never,
    })
    const res = await POST(jsonRequest(validBody))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: { id: "m1" } })
  })

  it("returns 422 with the reason when the send is refused", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(sendMessageWithClient).mockResolvedValue({
      ok: false,
      error: "This contact has opted out of text messages.",
    })
    const res = await POST(jsonRequest(validBody))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toMatch(/opted out/)
  })
})
