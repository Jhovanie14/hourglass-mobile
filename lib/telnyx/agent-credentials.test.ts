import { describe, it, expect, vi } from "vitest"
import { getOrCreateAgentCredential } from "./agent-credentials"

// Build a minimal Supabase-admin-like mock supporting:
//   from(t).select(c).eq(col,val).maybeSingle()  -> { data, error }
//   from(t).insert(row)                           -> { error }
function makeAdmin(opts: {
  existing?: { sip_username: string; sip_password: string } | null
  readErr?: unknown
  writeErr?: unknown
}) {
  const insert = vi.fn().mockResolvedValue({ error: opts.writeErr ?? null })
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: opts.existing ?? null, error: opts.readErr ?? null })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select, insert }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, insert, from }
}

function makeTelnyx(createImpl: ReturnType<typeof vi.fn>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { telephonyCredentials: { create: createImpl } } as any
}

describe("getOrCreateAgentCredential", () => {
  it("returns the stored credential and does NOT call Telnyx when one exists", async () => {
    const admin = makeAdmin({ existing: { sip_username: "u1", sip_password: "p1" } })
    const create = vi.fn()
    const telnyx = makeTelnyx(create)

    const result = await getOrCreateAgentCredential(admin.client, telnyx, "user-1", "conn-1")

    expect(result).toEqual({ login: "u1", password: "p1" })
    expect(create).not.toHaveBeenCalled()
    expect(admin.insert).not.toHaveBeenCalled()
  })

  it("creates, stores, and returns a new credential when none exists", async () => {
    const admin = makeAdmin({ existing: null })
    const create = vi.fn().mockResolvedValue({
      data: { id: "cred-9", sip_username: "u2", sip_password: "p2" },
    })
    const telnyx = makeTelnyx(create)

    const result = await getOrCreateAgentCredential(admin.client, telnyx, "user-2", "conn-1")

    expect(create).toHaveBeenCalledWith({ connection_id: "conn-1", name: "agent-user-2" })
    expect(admin.insert).toHaveBeenCalledWith({
      user_id: "user-2",
      telnyx_credential_id: "cred-9",
      sip_username: "u2",
      sip_password: "p2",
    })
    expect(result).toEqual({ login: "u2", password: "p2" })
  })

  it("throws if the Telnyx response is missing sip fields", async () => {
    const admin = makeAdmin({ existing: null })
    const create = vi.fn().mockResolvedValue({ data: { id: "cred-9" } })
    const telnyx = makeTelnyx(create)

    await expect(
      getOrCreateAgentCredential(admin.client, telnyx, "user-3", "conn-1")
    ).rejects.toThrow(/sip_username/)
  })
})
