import { describe, it, expect, vi, afterEach } from "vitest"
import { saveContact } from "./contacts-client"

afterEach(() => vi.restoreAllMocks())

describe("saveContact", () => {
  it("posts to /api/contacts and returns ok on success", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ contact: { id: "c1" } }), { status: 200 })
      )
    const res = await saveContact({
      phoneNumberId: "p1",
      contactNumber: "+12105551234",
      name: "Jane",
    })
    expect(res.ok).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/contacts")
    expect((init as RequestInit).method).toBe("POST")
    expect((init as RequestInit).headers).not.toHaveProperty("Authorization")
  })

  it("adds a bearer header when a token is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ contact: {} }), { status: 200 }))
    await saveContact(
      { phoneNumberId: "p1", contactNumber: "+12105551234", name: "Jane" },
      "tok-123"
    )
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-123")
  })

  it("returns the server error message on failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Name is required." }), { status: 422 })
    )
    const res = await saveContact({ phoneNumberId: "p1", contactNumber: "+1", name: "" })
    expect(res).toEqual({ ok: false, error: "Name is required." })
  })
})
