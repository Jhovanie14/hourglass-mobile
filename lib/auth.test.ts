import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted: vi.mock factories are hoisted above plain const declarations, and
// the @supabase/supabase-js factory dereferences the spy immediately rather
// than inside a nested closure, so a plain const would not be initialized yet.
const { cookieClient, createSupabaseClient } = vi.hoisted(() => ({
  cookieClient: { auth: { getClaims: vi.fn() } },
  createSupabaseClient: vi.fn(() => ({ marker: "bearer-client" })),
}))

vi.mock("@/lib/server", () => ({ createClient: vi.fn(async () => cookieClient) }))
vi.mock("@supabase/supabase-js", () => ({ createClient: createSupabaseClient }))

import { createRequestScopedClient } from "./auth"

function req(headers: Record<string, string> = {}) {
  return new Request("http://test/api/whatever", { headers })
}

describe("createRequestScopedClient", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key"
    cookieClient.auth.getClaims.mockResolvedValue({ data: null })
  })

  it("returns the cookie client when a cookie session exists", async () => {
    cookieClient.auth.getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1" } },
    })
    const client = await createRequestScopedClient(req())
    expect(client).toBe(cookieClient)
    expect(createSupabaseClient).not.toHaveBeenCalled()
  })

  it("builds a client carrying the caller's Bearer token so RLS sees the real user", async () => {
    const client = await createRequestScopedClient(
      req({ authorization: "Bearer abc123" })
    )
    expect(client).toEqual({ marker: "bearer-client" })
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      { global: { headers: { Authorization: "Bearer abc123" } } }
    )
  })

  it("accepts a lowercase bearer scheme", async () => {
    await createRequestScopedClient(req({ authorization: "bearer abc123" }))
    expect(createSupabaseClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "publishable-key",
      { global: { headers: { Authorization: "Bearer abc123" } } }
    )
  })

  it("returns null with neither a cookie session nor a token", async () => {
    expect(await createRequestScopedClient(req())).toBeNull()
  })

  it("returns null when the Authorization header is not a Bearer scheme", async () => {
    expect(
      await createRequestScopedClient(req({ authorization: "Basic abc" }))
    ).toBeNull()
  })
})
