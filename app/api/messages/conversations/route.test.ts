import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getRequestUserId: vi.fn() }))
vi.mock("@/lib/admin", () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock("@/lib/messaging", () => ({ getOrCreateConversationWithClient: vi.fn() }))

import { POST } from "./route"
import { getRequestUserId } from "@/lib/auth"
import { getOrCreateConversationWithClient } from "@/lib/messaging"

function jsonRequest(body: unknown) {
  return new Request("http://test/api/messages/conversations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/messages/conversations", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 without auth", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue(null)
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "+12105551234" })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when fields are missing", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await POST(jsonRequest({ phoneNumberId: "p1" }))
    expect(res.status).toBe(400)
  })

  it("returns the conversation id", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(getOrCreateConversationWithClient).mockResolvedValue({
      ok: true,
      conversationId: "c9",
    })
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "+12105551234" })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ conversationId: "c9" })
  })

  it("returns 422 when refused (bad number)", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(getOrCreateConversationWithClient).mockResolvedValue({
      ok: false,
      error: "Enter a valid phone number with country code (e.g. +12109348999).",
    })
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "nope" })
    )
    expect(res.status).toBe(422)
  })
})
