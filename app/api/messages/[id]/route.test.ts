import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ createRequestScopedClient: vi.fn() }))

import { DELETE } from "./route"
import { createRequestScopedClient } from "@/lib/auth"

const params = Promise.resolve({ id: "msg-1" })
const req = () => new Request("http://test/api/messages/msg-1", { method: "DELETE" })

/** Models `.delete().eq(...).select(...)`, which resolves to the rows actually
 *  removed. An RLS-blocked delete resolves to `[]` with NO error — the case
 *  that previously reported success and let the row reappear on refresh. */
function clientReturning(result: { data: { id: string }[] | null; error?: { message: string } }) {
  const select = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null })
  const eq = vi.fn(() => ({ select }))
  const del = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ delete: del }))
  return { client: { from }, from, del, eq, select }
}

describe("DELETE /api/messages/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when the caller has no cookie session and no Bearer token", async () => {
    vi.mocked(createRequestScopedClient).mockResolvedValue(null)
    expect((await DELETE(req(), { params })).status).toBe(401)
  })

  it("deletes the message through the caller's own client, so RLS applies", async () => {
    const { client, from, del, eq } = clientReturning({ data: [{ id: "msg-1" }] })
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(from).toHaveBeenCalledWith("messages")
    expect(del).toHaveBeenCalled()
    expect(eq).toHaveBeenCalledWith("id", "msg-1")
  })

  it("404s when RLS removed no rows, instead of reporting a delete that did not happen", async () => {
    const { client } = clientReturning({ data: [] })
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Message not found." })
  })

  it("422s and surfaces the error when the delete is rejected", async () => {
    const { client } = clientReturning({ data: null, error: { message: "row-level security" } })
    vi.mocked(createRequestScopedClient).mockResolvedValue(client as never)

    const res = await DELETE(req(), { params })

    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: "row-level security" })
  })
})
