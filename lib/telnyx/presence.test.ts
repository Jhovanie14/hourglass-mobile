import { describe, it, expect, vi } from "vitest"
import { recordHeartbeat, getOnlineAgentUserIds } from "./presence"

// Minimal Supabase-admin-like mock.
//   from(t).upsert(row, opts)                 -> { error }
//   from(t).select(c).gte(col,val)            -> { data, error }
function makeAdmin(opts: {
  online?: { user_id: string }[]
  readErr?: unknown
  writeErr?: unknown
}) {
  const upsert = vi.fn().mockResolvedValue({ error: opts.writeErr ?? null })
  const gte = vi
    .fn()
    .mockResolvedValue({ data: opts.online ?? [], error: opts.readErr ?? null })
  const select = vi.fn(() => ({ gte }))
  const from = vi.fn(() => ({ upsert, select }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, upsert, select, gte, from }
}

describe("recordHeartbeat", () => {
  it("upserts the user's row with the current time, keyed on user_id", async () => {
    const admin = makeAdmin({})
    const now = new Date("2026-06-19T12:00:00.000Z")

    await recordHeartbeat(admin.client, "user-1", now)

    expect(admin.from).toHaveBeenCalledWith("agent_presence")
    expect(admin.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", last_seen_at: "2026-06-19T12:00:00.000Z" },
      { onConflict: "user_id" }
    )
  })

  it("throws when the upsert returns an error", async () => {
    const admin = makeAdmin({ writeErr: new Error("write failed") })
    await expect(
      recordHeartbeat(admin.client, "user-1", new Date())
    ).rejects.toThrow(/write failed/)
  })
})

describe("getOnlineAgentUserIds", () => {
  it("returns user ids seen within the default 30s window", async () => {
    const admin = makeAdmin({ online: [{ user_id: "a" }, { user_id: "b" }] })
    const now = new Date("2026-06-19T12:00:30.000Z")

    const ids = await getOnlineAgentUserIds(admin.client, now)

    expect(admin.select).toHaveBeenCalledWith("user_id")
    // cutoff = now - 30s
    expect(admin.gte).toHaveBeenCalledWith(
      "last_seen_at",
      "2026-06-19T12:00:00.000Z"
    )
    expect(ids).toEqual(["a", "b"])
  })

  it("honors a custom freshness window", async () => {
    const admin = makeAdmin({ online: [] })
    const now = new Date("2026-06-19T12:01:00.000Z")

    await getOnlineAgentUserIds(admin.client, now, 15)

    expect(admin.gte).toHaveBeenCalledWith(
      "last_seen_at",
      "2026-06-19T12:00:45.000Z"
    )
  })

  it("throws when the query returns an error", async () => {
    const admin = makeAdmin({ readErr: new Error("read failed") })
    await expect(
      getOnlineAgentUserIds(admin.client, new Date())
    ).rejects.toThrow(/read failed/)
  })
})
