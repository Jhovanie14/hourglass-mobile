import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getRequestUserId: vi.fn() }))
vi.mock("@/lib/admin", () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock("@/lib/contacts", () => ({ upsertContactWithClient: vi.fn() }))

import { POST } from "./route"
import { getRequestUserId } from "@/lib/auth"
import { upsertContactWithClient } from "@/lib/contacts"

function jsonRequest(body: unknown) {
  return new Request("http://test/api/contacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/contacts", () => {
  beforeEach(() => vi.clearAllMocks())

  it("returns 401 without auth", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue(null)
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "+12105551234", name: "Jane" })
    )
    expect(res.status).toBe(401)
  })

  it("returns 400 when fields are missing", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "+12105551234" })
    )
    expect(res.status).toBe(400)
  })

  it("returns the saved contact", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(upsertContactWithClient).mockResolvedValue({
      ok: true,
      contact: {
        id: "c1",
        phoneNumberId: "p1",
        contactNumber: "+12105551234",
        name: "Jane Doe",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    })
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "+12105551234", name: "Jane Doe" })
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      contact: {
        id: "c1",
        phoneNumberId: "p1",
        contactNumber: "+12105551234",
        name: "Jane Doe",
        updatedAt: "2026-07-21T00:00:00.000Z",
      },
    })
  })

  it("returns 422 when refused (bad number)", async () => {
    vi.mocked(getRequestUserId).mockResolvedValue("user-1")
    vi.mocked(upsertContactWithClient).mockResolvedValue({
      ok: false,
      error: "Enter a valid phone number with country code (e.g. +12109348999).",
    })
    const res = await POST(
      jsonRequest({ phoneNumberId: "p1", contactNumber: "nope", name: "Jane" })
    )
    expect(res.status).toBe(422)
  })
})
